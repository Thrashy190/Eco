package connect

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func join(t *testing.T, h *Hub, user, id string) (*Conn, func()) {
	t.Helper()
	c, leave, err := h.Join(user, Info{ID: id, Name: id})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(leave)
	return c, leave
}

// next returns the first queued event with this name, skipping the others.
func next(c *Conn, name string) (Event, bool) {
	for {
		select {
		case e := <-c.Events:
			if e.Name == name {
				return e, true
			}
		default:
			return Event{}, false
		}
	}
}

func TestCommandsReachOnlyTheTarget(t *testing.T) {
	h := NewHub()
	phone, _ := join(t, h, "diego", "phone-0001")
	laptop, _ := join(t, h, "diego", "laptop-001")
	tablet, _ := join(t, h, "diego", "tablet-001")
	if err := h.Send("diego", "phone-0001", "laptop-001", "pause", nil); err != nil {
		t.Fatal(err)
	}
	e, ok := next(laptop, "command")
	if !ok || !strings.Contains(string(e.Data), `"action":"pause"`) || !strings.Contains(string(e.Data), `"from":"phone-0001"`) {
		t.Fatalf("laptop got %q", e.Data)
	}
	if _, ok := next(tablet, "command"); ok {
		t.Error("a device that was not the target received the command")
	}
	if _, ok := next(phone, "command"); ok {
		t.Error("the sender received its own command")
	}
}

// The heart of this package: one account can never see or touch another's devices.
func TestUsersAreIsolated(t *testing.T) {
	h := NewHub()
	mine, _ := join(t, h, "diego", "diego-phone")
	theirs, _ := join(t, h, "ana", "ana-laptop1")
	// Joining sends the device list; nobody may appear in another account's list
	if e, ok := next(mine, "devices"); !ok || strings.Contains(string(e.Data), "ana-laptop1") {
		t.Errorf("diego's list: %s", e.Data)
	}
	if e, ok := next(theirs, "devices"); !ok || strings.Contains(string(e.Data), "diego-phone") {
		t.Errorf("ana's list: %s", e.Data)
	}

	for name, err := range map[string]error{
		"command to another user's device":    h.Send("diego", "diego-phone", "ana-laptop1", "pause", nil),
		"command claiming their device sent":  h.Send("diego", "ana-laptop1", "diego-phone", "pause", nil),
		"state for another user's device":     h.Report("diego", "ana-laptop1", json.RawMessage(`{"playing":true}`)),
		"command from an unconnected account": h.Send("stranger", "diego-phone", "ana-laptop1", "pause", nil),
	} {
		if !errors.Is(err, ErrUnknownDevice) {
			t.Errorf("%s: err = %v", name, err)
		}
	}
	if _, ok := next(theirs, "command"); ok {
		t.Error("ana's device received a command from diego")
	}

	if err := h.Report("diego", "diego-phone", json.RawMessage(`{"secret":"my song"}`)); err != nil {
		t.Fatal(err)
	}
	if e, ok := next(theirs, "state"); ok {
		t.Errorf("ana saw diego's playback: %s", e.Data)
	}
}

func TestUsernamesIgnoreCaseLikeNavidrome(t *testing.T) {
	h := NewHub()
	join(t, h, "Diego", "phone-0001")
	laptop, _ := join(t, h, "diego", "laptop-001")
	if err := h.Send("DIEGO", "phone-0001", "laptop-001", "next", nil); err != nil {
		t.Fatal(err)
	}
	if _, ok := next(laptop, "command"); !ok {
		t.Error("the command did not arrive")
	}
}

func TestStateGoesToTheOtherDevicesAndNewcomersSeeIt(t *testing.T) {
	h := NewHub()
	join(t, h, "diego", "phone-0001")
	laptop, _ := join(t, h, "diego", "laptop-001")
	if err := h.Report("diego", "phone-0001", json.RawMessage(`{"playing":true}`)); err != nil {
		t.Fatal(err)
	}
	if e, ok := next(laptop, "state"); !ok || !strings.Contains(string(e.Data), `"playing":true`) {
		t.Errorf("laptop got %q", e.Data)
	}
	tablet, _ := join(t, h, "diego", "tablet-001")
	if e, ok := next(tablet, "devices"); !ok || !strings.Contains(string(e.Data), `"playing":true`) {
		t.Errorf("a device joining later did not see what plays: %s", e.Data)
	}
}

func TestReconnectReplacesAndKeepsState(t *testing.T) {
	h := NewHub()
	first, leaveFirst, err := h.Join("diego", Info{ID: "phone-0001", Name: "Phone"})
	if err != nil {
		t.Fatal(err)
	}
	h.Report("diego", "phone-0001", json.RawMessage(`{"playing":true}`))
	second, leaveSecond, err := h.Join("diego", Info{ID: "phone-0001", Name: "Phone"})
	if err != nil {
		t.Fatal(err)
	}
	defer leaveSecond()
	select {
	case <-first.Closed:
	default:
		t.Error("the old connection was not closed")
	}
	leaveFirst() // the old handler ending must not remove the new connection
	if err := h.Report("diego", "phone-0001", json.RawMessage(`{}`)); err != nil {
		t.Errorf("the device vanished after its old connection ended: %v", err)
	}
	if e, ok := next(second, "devices"); !ok || !strings.Contains(string(e.Data), `"playing":true`) {
		t.Errorf("state lost on reconnect: %s", e.Data)
	}
}

func TestLeavingIsAnnouncedAndCleansUp(t *testing.T) {
	h := NewHub()
	laptop, _ := join(t, h, "diego", "laptop-001")
	_, leave := join(t, h, "diego", "phone-0001")
	leave()
	var latest Event
	for e, ok := next(laptop, "devices"); ok; e, ok = next(laptop, "devices") {
		latest = e
	}
	if strings.Contains(string(latest.Data), "phone-0001") || !strings.Contains(string(latest.Data), "laptop-001") {
		t.Errorf("list after leaving: %s", latest.Data)
	}
	if err := h.Send("diego", "laptop-001", "phone-0001", "pause", nil); !errors.Is(err, ErrUnknownDevice) {
		t.Errorf("err = %v", err)
	}
}

func TestSlowDeviceIsDisconnectedNotWaitedFor(t *testing.T) {
	h := NewHub()
	join(t, h, "diego", "phone-0001")
	slow, _ := join(t, h, "diego", "slow-device")
	for i := 0; i < cap(slow.Events)+5; i++ {
		if err := h.Send("diego", "phone-0001", "slow-device", "next", nil); err != nil {
			t.Fatal(err)
		}
	}
	select {
	case <-slow.Closed:
	default:
		t.Error("a device that stopped reading was not disconnected")
	}
}

func TestDeviceLimitAndNames(t *testing.T) {
	h := NewHub()
	for i := 0; i < maxDevices; i++ {
		join(t, h, "diego", "device-"+strings.Repeat("x", i+1))
	}
	if _, _, err := h.Join("diego", Info{ID: "one-too-many"}); !errors.Is(err, ErrTooManyDevices) {
		t.Errorf("err = %v", err)
	}
	if got := cleanName("  "); got != "Unknown device" {
		t.Errorf("empty name = %q", got)
	}
	if got := cleanName(strings.Repeat("ñ", 100)); len([]rune(got)) != maxNameRunes {
		t.Errorf("long name kept %d characters", len([]rune(got)))
	}
	for _, bad := range []string{"", "short", "with space!", "../../etc/x", strings.Repeat("x", 65)} {
		if ValidID(bad) {
			t.Errorf("ValidID(%q) = true", bad)
		}
	}
	if ValidAction("delete_everything") || !ValidAction("pause") {
		t.Error("ValidAction is wrong")
	}
}
