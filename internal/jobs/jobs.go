// Package jobs is the download queue behind the web UI: one song at a time (kind to YouTube and the disk),
// each with a state and a progress percentage the UI turns into a spinner or a ring.
package jobs

import (
	"context"
	"sort"
	"strconv"
	"sync"
	"time"
)

// State of a job.
type State string

const (
	Queued      State = "queued"
	Searching   State = "searching"
	Downloading State = "downloading"
	Tagging     State = "tagging"
	Ready       State = "ready"
	Failed      State = "error"
)

// Job is one requested download. The JSON form is what the API returns.
type Job struct {
	ID         string  `json:"id"`
	SpotifyID  string  `json:"spotify_id"`
	State      State   `json:"state"`
	Progress   float64 `json:"progress"` // 0–100 while downloading
	Title      string  `json:"title"`
	Artist     string  `json:"artist"`
	Album      string  `json:"album"`
	File       string  `json:"file,omitempty"`
	LibraryID  string  `json:"library_id,omitempty"` // Navidrome's ID once the song is playable
	Kind       string  `json:"kind,omitempty"`       // for media imports: video, podcast, audiobook or other
	MediaID    string  `json:"media_id,omitempty"`   // for media imports: the item's ID once it is ready
	Error      string  `json:"error,omitempty"`
	User       string  `json:"user"`
	StartedAt  int64   `json:"started_at"`
	FinishedAt int64   `json:"finished_at,omitempty"`
}

// Done reports whether the job reached a final state.
func (j Job) Done() bool { return j.State == Ready || j.State == Failed }

// RunFunc does the work of one job. It reports changes through set, which edits the job under the manager's lock.
type RunFunc func(ctx context.Context, job Job, payload any, set func(func(*Job))) error

type item struct {
	job     *Job
	payload any
}

// Manager queues and runs jobs.
type Manager struct {
	run    RunFunc
	mu     sync.Mutex
	jobs   map[string]*Job
	active map[string]string // Spotify ID → job ID, so a song is never queued twice
	queue  chan item
	seq    int
}

// NewManager starts a manager with one worker. Jobs finished more than an hour ago are forgotten.
func NewManager(ctx context.Context, run RunFunc) *Manager {
	m := &Manager{run: run, jobs: map[string]*Job{}, active: map[string]string{}, queue: make(chan item, 500)}
	go m.work(ctx)
	return m
}

// Submit queues a download. If that song is already queued or running, the existing job is returned
// and the boolean is false.
func (m *Manager) Submit(spotifyID, user string, payload any) (Job, bool) {
	return m.SubmitWith(spotifyID, user, payload, nil)
}

// SubmitWith is Submit plus a chance to fill in extra fields of a new job (the key is any unique string).
func (m *Manager) SubmitWith(spotifyID, user string, payload any, init func(*Job)) (Job, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if id, ok := m.active[spotifyID]; ok {
		return *m.jobs[id], false
	}
	m.seq++
	j := &Job{ID: strconv.FormatInt(time.Now().UnixMilli(), 36) + strconv.Itoa(m.seq), SpotifyID: spotifyID,
		State: Queued, User: user, StartedAt: time.Now().Unix()}
	if init != nil {
		init(j)
	}
	select {
	case m.queue <- item{j, payload}:
	default:
		j.State, j.Error, j.FinishedAt = Failed, "the download queue is full", time.Now().Unix()
		m.jobs[j.ID] = j
		return *j, true
	}
	m.jobs[j.ID], m.active[spotifyID] = j, j.ID
	return *j, true
}

// List returns the recent jobs, oldest first.
func (m *Manager) List() []Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	cutoff := time.Now().Add(-time.Hour).Unix()
	out := make([]Job, 0, len(m.jobs))
	for id, j := range m.jobs {
		if j.Done() && j.FinishedAt < cutoff {
			delete(m.jobs, id)
			continue
		}
		out = append(out, *j)
	}
	sort.Slice(out, func(a, b int) bool {
		return out[a].StartedAt < out[b].StartedAt || (out[a].StartedAt == out[b].StartedAt && out[a].ID < out[b].ID)
	})
	return out
}

func (m *Manager) work(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case it := <-m.queue:
			set := func(f func(*Job)) {
				m.mu.Lock()
				f(it.job)
				m.mu.Unlock()
			}
			m.mu.Lock()
			snapshot := *it.job
			m.mu.Unlock()
			err := m.run(ctx, snapshot, it.payload, set)
			set(func(j *Job) {
				if err != nil {
					j.State, j.Error = Failed, err.Error()
				} else if j.State != Failed {
					j.State, j.Progress = Ready, 100
				}
				j.FinishedAt = time.Now().Unix()
				delete(m.active, j.SpotifyID)
			})
		}
	}
}
