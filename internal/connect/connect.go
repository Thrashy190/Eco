// Package connect lets one user's devices see and control each other, like Spotify Connect: which device is playing
// what, and pause, skip, volume or moving playback to another one. Every device keeps a stream open to the server,
// so they do not need to be on the same network.
//
// Devices are grouped by user and nothing here crosses that line: a device can only be listed by, report to, or
// receive commands from devices of the same account. The server does not interpret states or command values; it
// only passes them between devices of one person.
package connect

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"sync"
	"time"
)

// maxDevices stops one account from growing the hub without limit.
const maxDevices = 24

const maxNameRunes = 60

var deviceID = regexp.MustCompile(`^[A-Za-z0-9_-]{8,64}$`)

// ValidID reports whether id is an acceptable device identifier.
func ValidID(id string) bool { return deviceID.MatchString(id) }

// actions are the commands a device may send to another.
var actions = map[string]bool{
	"load": true, "resume": true, "transfer": true, "toggle": true, "pause": true, "next": true, "previous": true, "seek": true, "jump": true,
	"volume": true, "speed": true, "shuffle": true, "repeat": true, "play_next": true, "enqueue": true, "move": true, "autoplay": true,
}

// ValidAction reports whether action is a known command.
func ValidAction(action string) bool { return actions[action] }

// ErrUnknownDevice means the device is not connected to this user's account. It says the same whether the device
// is offline or belongs to someone else, so an ID reveals nothing about other accounts.
var ErrUnknownDevice = errors.New("no such device")

// ErrTooManyDevices is returned when an account already has maxDevices connected.
var ErrTooManyDevices = errors.New("too many connected devices")

// Info describes a device to the others.
type Info struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CanVolume bool   `json:"can_volume"` // iPhones cannot change volume from a web page
}

// Event is one message for a device.
type Event struct {
	Name string
	Data []byte
}

// Conn is a connected device.
type Conn struct {
	Info
	Events chan Event    // what to send to the device
	Closed chan struct{} // closed when the connection must end
	state  json.RawMessage
	at     time.Time
	once   sync.Once
	// For a device that asks for its events instead of keeping a stream open (Hub.Hold); guarded by Hub.mu.
	held    bool
	holders int
	linger  *time.Timer
}

func (c *Conn) close() { c.once.Do(func() { close(c.Closed) }) }

func (c *Conn) isClosed() bool {
	select {
	case <-c.Closed:
		return true
	default:
		return false
	}
}

// offer queues an event. A device too slow to keep up is disconnected instead of holding everyone else back;
// its browser reconnects on its own.
func (c *Conn) offer(e Event) {
	select {
	case c.Events <- e:
	default:
		c.close()
	}
}

// Hub holds every connected device.
type Hub struct {
	mu    sync.Mutex
	users map[string]map[string]*Conn
}

// NewHub returns an empty hub.
func NewHub() *Hub { return &Hub{users: map[string]map[string]*Conn{}} }

// Navidrome ignores case in usernames, so Diego and diego are one account.
func key(user string) string { return strings.ToLower(user) }

func cleanName(name string) string {
	name = strings.TrimSpace(name)
	if name == "" {
		return "Unknown device"
	}
	if runes := []rune(name); len(runes) > maxNameRunes {
		return string(runes[:maxNameRunes])
	}
	return name
}

// Join connects a device. Joining again with the same ID replaces the old connection (a reconnecting browser often
// arrives before the server notices the old one died). The returned function disconnects it.
func (h *Hub) Join(user string, info Info) (*Conn, func(), error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	conn, err := h.join(user, info)
	if err != nil {
		return nil, nil, err
	}
	return conn, func() { h.mu.Lock(); defer h.mu.Unlock(); h.leave(user, conn) }, nil
}

// join adds a device; h.mu must be held.
func (h *Hub) join(user string, info Info) (*Conn, error) {
	info.Name = cleanName(info.Name)
	conn := &Conn{Info: info, Events: make(chan Event, 64), Closed: make(chan struct{})}
	u := key(user)
	devices := h.users[u]
	if devices == nil {
		devices = map[string]*Conn{}
		h.users[u] = devices
	}
	if old, ok := devices[info.ID]; ok {
		conn.state, conn.at = old.state, old.at // the same device keeps what it was playing
		old.close()
	} else if len(devices) >= maxDevices {
		return nil, ErrTooManyDevices
	}
	devices[info.ID] = conn
	h.broadcastDevices(devices)
	return conn, nil
}

// leave disconnects a device, unless a newer connection already replaced it; h.mu must be held.
func (h *Hub) leave(user string, conn *Conn) {
	u := key(user)
	conn.close()
	devices := h.users[u]
	if devices[conn.ID] != conn {
		return
	}
	delete(devices, conn.ID)
	if len(devices) == 0 {
		delete(h.users, u)
		return
	}
	h.broadcastDevices(devices)
}

// Hold connects a device that cannot keep a stream open, such as a TV app, which asks for its events again and again
// instead. Each request holds the device; once the last one ends, it stays connected for linger, so the other devices
// do not see it leave and come back between two requests. Events wait in Conn.Events in the meantime. Call the
// returned function when the request ends.
func (h *Hub) Hold(user string, info Info, linger time.Duration) (*Conn, func(), error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	info.Name = cleanName(info.Name)
	conn := h.users[key(user)][info.ID]
	if conn == nil || !conn.held || conn.isClosed() || conn.Info != info {
		var err error
		if conn, err = h.join(user, info); err != nil {
			return nil, nil, err
		}
		conn.held = true
	}
	conn.holders++
	if conn.linger != nil {
		conn.linger.Stop()
		conn.linger = nil
	}
	var once sync.Once
	release := func() {
		once.Do(func() {
			h.mu.Lock()
			defer h.mu.Unlock()
			conn.holders--
			if conn.holders > 0 {
				return
			}
			conn.linger = time.AfterFunc(linger, func() {
				h.mu.Lock()
				defer h.mu.Unlock()
				if conn.holders == 0 {
					h.leave(user, conn)
				}
			})
		})
	}
	return conn, release, nil
}

type deviceOut struct {
	Info
	State json.RawMessage `json:"state,omitempty"`
	AgeMs int64           `json:"age_ms,omitempty"` // how long ago the state was reported
}

func encode(v any) []byte {
	data, err := json.Marshal(v)
	if err != nil {
		return []byte("{}") // only plain structs and already valid JSON reach this
	}
	return data
}

func (h *Hub) broadcastDevices(devices map[string]*Conn) {
	list := make([]deviceOut, 0, len(devices))
	for _, c := range devices {
		out := deviceOut{Info: c.Info, State: c.state}
		if c.state != nil {
			out.AgeMs = time.Since(c.at).Milliseconds()
		}
		list = append(list, out)
	}
	event := Event{"devices", encode(list)}
	for _, c := range devices {
		c.offer(event)
	}
}

// Report stores what a device is playing and tells the user's other devices.
func (h *Hub) Report(user, id string, state json.RawMessage) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	devices := h.users[key(user)]
	conn, ok := devices[id]
	if !ok {
		return ErrUnknownDevice
	}
	conn.state, conn.at = state, time.Now()
	event := Event{"state", encode(struct {
		Device string          `json:"device"`
		State  json.RawMessage `json:"state"`
	}{id, state})}
	for otherID, c := range devices {
		if otherID != id {
			c.offer(event)
		}
	}
	return nil
}

// Send passes a command from one of a user's devices to another. Both must be connected to that same account.
func (h *Hub) Send(user, from, target, action string, value json.RawMessage) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	devices := h.users[key(user)]
	if _, ok := devices[from]; !ok {
		return ErrUnknownDevice
	}
	conn, ok := devices[target]
	if !ok {
		return ErrUnknownDevice
	}
	conn.offer(Event{"command", encode(struct {
		From   string          `json:"from"`
		Action string          `json:"action"`
		Value  json.RawMessage `json:"value,omitempty"`
	}{from, action, value})})
	return nil
}
