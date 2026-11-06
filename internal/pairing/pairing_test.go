package pairing

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestTVCollectsWhatThePhoneApproved(t *testing.T) {
	s := New()
	code, secret, err := s.Start()
	if err != nil {
		t.Fatal(err)
	}
	if len(code) != CodeLength || strings.Trim(code, Alphabet) != "" {
		t.Fatalf("code %q uses letters outside the alphabet", code)
	}
	if _, err := s.Collect(code, secret); !errors.Is(err, ErrPending) {
		t.Fatalf("before approval: %v", err)
	}
	// People type what they read: lower case, with the dash the TV shows
	typed := strings.ToLower(code[:3] + "-" + code[3:])
	if err := s.Approve(typed, Cred{"diego", "token", "salt"}); err != nil {
		t.Fatal(err)
	}
	got, err := s.Collect(code, secret)
	if err != nil || got != (Cred{"diego", "token", "salt"}) {
		t.Fatalf("got %+v, %v", got, err)
	}
	if _, err := s.Collect(code, secret); !errors.Is(err, ErrUnknown) {
		t.Fatalf("a code must sign in only once, got %v", err)
	}
}

// Someone who reads the code off the screen must not be able to collect the account.
func TestTheCodeAloneIsNotEnough(t *testing.T) {
	s := New()
	code, _, _ := s.Start()
	if err := s.Approve(code, Cred{"diego", "token", "salt"}); err != nil {
		t.Fatal(err)
	}
	for _, guess := range []string{"", "00", strings.Repeat("a", 48)} {
		if _, err := s.Collect(code, guess); !errors.Is(err, ErrUnknown) {
			t.Fatalf("secret %q: %v", guess, err)
		}
	}
}

// Approving twice would let a second person replace the account the TV signs in to.
func TestACodeIsApprovedOnce(t *testing.T) {
	s := New()
	code, secret, _ := s.Start()
	if err := s.Approve(code, Cred{"diego", "t", "s"}); err != nil {
		t.Fatal(err)
	}
	if err := s.Approve(code, Cred{"ana", "t", "s"}); !errors.Is(err, ErrTaken) {
		t.Fatalf("second approval: %v", err)
	}
	if got, _ := s.Collect(code, secret); got.User != "diego" {
		t.Fatalf("the TV got %q", got.User)
	}
}

func TestCodesExpire(t *testing.T) {
	s := New()
	now := time.Now()
	s.now = func() time.Time { return now }
	code, secret, _ := s.Start()
	now = now.Add(Lifetime + time.Second)
	if err := s.Approve(code, Cred{"diego", "t", "s"}); !errors.Is(err, ErrUnknown) {
		t.Fatalf("approving an expired code: %v", err)
	}
	if _, err := s.Collect(code, secret); !errors.Is(err, ErrUnknown) {
		t.Fatalf("collecting an expired code: %v", err)
	}
}

func TestPendingCodesAreLimited(t *testing.T) {
	s := New()
	now := time.Now()
	s.now = func() time.Time { return now }
	for i := 0; i < maxPending; i++ {
		if _, _, err := s.Start(); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := s.Start(); !errors.Is(err, ErrBusy) {
		t.Fatalf("over the limit: %v", err)
	}
	now = now.Add(Lifetime + time.Second) // expired codes make room again
	if _, _, err := s.Start(); err != nil {
		t.Fatal(err)
	}
}
