//go:build !darwin && !windows

package updater

import "context"

// Install 은 macOS·Windows 에서만 동작한다. 다른 OS 는 릴리스 페이지에서 직접 내려받는다.
func (u *Updater) Install(ctx context.Context, pid int, progress func(Progress)) error {
	return ErrUnsupported
}
