package cluster_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/kiramopay/backend/internal/cluster"
	"github.com/kiramopay/backend/internal/testutil"
)

// TestTryRunExclusiveMutualExclusion verifies that while one caller holds the
// lock for a key, a second caller with the SAME key skips its run (ran=false)
// instead of executing fn concurrently — the multi-instance guarantee.
func TestTryRunExclusiveMutualExclusion(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	key := cluster.KeyReconcile

	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	type res struct {
		ran bool
		err error
	}
	holderDone := make(chan res, 1)

	// Holder grabs the lock and stays inside fn until released.
	go func() {
		ran, err := cluster.TryRunExclusive(ctx, pool, key, func(context.Context) error {
			entered <- struct{}{}
			<-release
			return nil
		})
		holderDone <- res{ran, err}
	}()

	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("holder never entered fn")
	}

	// Contender: same key, lock is held → must be skipped, fn must not run.
	contenderRan := false
	ran, err := cluster.TryRunExclusive(ctx, pool, key, func(context.Context) error {
		contenderRan = true
		return nil
	})
	if err != nil {
		t.Fatalf("contender returned error: %v", err)
	}
	if ran {
		t.Fatal("contender reported it ran while the lock was held")
	}
	if contenderRan {
		t.Fatal("contender executed fn while another instance held the lock")
	}

	close(release)
	select {
	case r := <-holderDone:
		if !r.ran || r.err != nil {
			t.Fatalf("holder run: ran=%v err=%v", r.ran, r.err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("holder never finished")
	}

	// Lock was released → a fresh attempt on the same key now succeeds.
	ran, err = cluster.TryRunExclusive(ctx, pool, key, func(context.Context) error { return nil })
	if err != nil || !ran {
		t.Fatalf("after release, expected ran=true err=nil, got ran=%v err=%v", ran, err)
	}
}

// TestTryRunExclusiveDifferentKeysConcurrent verifies that distinct keys do not
// block each other: a different worker's lock can run while another is held.
func TestTryRunExclusiveDifferentKeysConcurrent(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()

	entered := make(chan struct{}, 1)
	release := make(chan struct{})
	go func() {
		_, _ = cluster.TryRunExclusive(ctx, pool, cluster.KeyReconcile, func(context.Context) error {
			entered <- struct{}{}
			<-release
			return nil
		})
	}()

	select {
	case <-entered:
	case <-time.After(5 * time.Second):
		t.Fatal("holder never entered fn")
	}
	defer close(release)

	ran, err := cluster.TryRunExclusive(ctx, pool, cluster.KeyPayoutPoller, func(context.Context) error { return nil })
	if err != nil {
		t.Fatalf("different-key run returned error: %v", err)
	}
	if !ran {
		t.Fatal("a different key was blocked by an unrelated held lock")
	}
}

// TestTryRunExclusiveReleasesOnError verifies the lock is released even when fn
// returns an error, so the next tick is not wedged.
func TestTryRunExclusiveReleasesOnError(t *testing.T) {
	pool := testutil.TestDB(t)
	ctx := context.Background()
	key := cluster.KeyEscrowPoller
	sentinel := errors.New("boom")

	ran, err := cluster.TryRunExclusive(ctx, pool, key, func(context.Context) error { return sentinel })
	if !ran {
		t.Fatal("expected ran=true when the lock was free")
	}
	if !errors.Is(err, sentinel) {
		t.Fatalf("expected fn error to propagate, got %v", err)
	}

	// The errored run must have released the lock.
	ran, err = cluster.TryRunExclusive(ctx, pool, key, func(context.Context) error { return nil })
	if err != nil || !ran {
		t.Fatalf("after errored run, expected lock free; got ran=%v err=%v", ran, err)
	}
}
