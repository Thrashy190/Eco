// Package pairing signs a TV in without typing a password on its remote. The TV asks for a short code and shows it;
// someone already signed in to Eco types that code on their phone, and the TV then receives the same credentials the
// web app keeps (user + token + salt, never a password).
//
// The code is only what a person reads off the screen: collecting the credentials also takes a secret that only the
// TV knows, so seeing someone's TV, or guessing codes, gives nobody else their account. Codes expire after a few
// minutes and are good for one sign-in.
package pairing

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"sync"
	"time"
)

// Lifetime is how long a code can be used.
const Lifetime = 10 * time.Minute

// maxPending stops anyone from filling the server's memory with codes nobody will use.
const maxPending = 64

// Alphabet leaves out letters and digits that look alike on a TV (0/O, 1/I/L, 5/S, 2/Z, 8/B, U/V).
const Alphabet = "ACDEFGHJKMNPQRTWXY34679"

// CodeLength is long enough that guessing a code that someone is about to use is hopeless (23^6 ≈ 148 million).
const CodeLength = 6

var (
	// ErrUnknown says the code does not exist or has expired. It says the same for a wrong secret.
	ErrUnknown = errors.New("that code has expired or does not exist")
	// ErrTaken says someone already approved this code.
	ErrTaken = errors.New("that code was already used")
	// ErrBusy says too many codes are waiting.
	ErrBusy = errors.New("too many TVs are waiting to be connected; try again in a few minutes")
	// ErrPending says nobody has approved the code yet.
	ErrPending = errors.New("not approved yet")
)

// Cred is what the TV receives: the same as the web app stores.
type Cred struct {
	User  string `json:"u"`
	Token string `json:"t"`
	Salt  string `json:"s"`
}

type request struct {
	secret  string
	expires time.Time
	cred    *Cred
}

// Store holds the codes waiting to be used. The zero value is not usable; use New.
type Store struct {
	mu      sync.Mutex
	pending map[string]*request
	now     func() time.Time
}

// New returns an empty store.
func New() *Store { return &Store{pending: map[string]*request{}, now: time.Now} }

func (s *Store) sweep() {
	now := s.now()
	for code, r := range s.pending {
		if now.After(r.expires) {
			delete(s.pending, code)
		}
	}
}

func randomCode() (string, error) {
	buf := make([]byte, CodeLength)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, CodeLength)
	for i, b := range buf {
		// 256 is not a multiple of len(Alphabet): the first letters come up a little more often, which costs a
		// fraction of a bit of a code that lives ten minutes
		out[i] = Alphabet[int(b)%len(Alphabet)]
	}
	return string(out), nil
}

// Start creates a code for a TV, and the secret the TV must show to collect the credentials.
func (s *Store) Start() (code, secret string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	if len(s.pending) >= maxPending {
		return "", "", ErrBusy
	}
	raw := make([]byte, 24)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	secret = hex.EncodeToString(raw)
	for {
		if code, err = randomCode(); err != nil {
			return "", "", err
		}
		if _, used := s.pending[code]; !used {
			break
		}
	}
	s.pending[code] = &request{secret: secret, expires: s.now().Add(Lifetime)}
	return code, secret, nil
}

// Clean turns what a person typed into a code: capitals, without spaces or dashes.
func Clean(code string) string {
	code = strings.ToUpper(code)
	return strings.Map(func(r rune) rune {
		if r == ' ' || r == '-' {
			return -1
		}
		return r
	}, code)
}

// Approve gives a waiting TV these credentials.
func (s *Store) Approve(code string, cred Cred) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	r, ok := s.pending[Clean(code)]
	if !ok {
		return ErrUnknown
	}
	if r.cred != nil {
		return ErrTaken
	}
	r.cred = &cred
	return nil
}

// Collect hands the TV its credentials once someone approved the code, and forgets the code.
func (s *Store) Collect(code, secret string) (Cred, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sweep()
	code = Clean(code)
	r, ok := s.pending[code]
	if !ok || subtle.ConstantTimeCompare([]byte(r.secret), []byte(secret)) != 1 {
		return Cred{}, ErrUnknown
	}
	if r.cred == nil {
		return Cred{}, ErrPending
	}
	delete(s.pending, code)
	return *r.cred, nil
}
