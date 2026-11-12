//go:build !windows

package updater

// CleanupOld 는 Windows 자동 업데이트가 남기는 임시 파일을 지운다. 다른 OS 에서는 할 일이 없다.
func CleanupOld() {}
