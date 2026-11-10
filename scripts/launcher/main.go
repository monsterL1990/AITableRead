// WeiDu desktop launcher.
//
// Next.js standalone loads traced files with dynamic require, and it may
// spawn workers using the current Node binary. A single-file wrapper that
// replaces node breaks that. This program is only the native file the user
// double-clicks. The official Node runtime in runtime/ runs desk.mjs, which
// starts the standalone server.
package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
)

func main() {
	root, err := packageRoot()
	if err != nil {
		fail(err)
	}
	if err := os.Chdir(root); err != nil {
		fail(err)
	}

	nodeName := "node"
	if runtime.GOOS == "windows" {
		nodeName = "node.exe"
	}
	nodePath := filepath.Join(root, "runtime", nodeName)
	deskPath := filepath.Join(root, "desk.mjs")
	if _, err := os.Stat(nodePath); err != nil {
		fmt.Fprintf(os.Stderr, "WeiDu could not find the bundled runtime:\n%s\n", nodePath)
		fmt.Fprintf(os.Stderr, "Keep the unpacked folder intact. Do not copy only the launcher.\n")
		pauseWindows()
		os.Exit(1)
	}
	if _, err := os.Stat(deskPath); err != nil {
		fmt.Fprintf(os.Stderr, "WeiDu could not find desk.mjs next to the launcher.\n")
		pauseWindows()
		os.Exit(1)
	}

	if runtime.GOOS != "windows" {
		err := syscall.Exec(nodePath, []string{nodePath, deskPath}, os.Environ())
		fmt.Fprintf(os.Stderr, "WeiDu could not start: %v\n", err)
		os.Exit(1)
	}

	cmd := exec.Command(nodePath, deskPath)
	cmd.Dir = root
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "WeiDu could not start: %v\n", err)
		pauseWindows()
		os.Exit(1)
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	go func() {
		for range sigCh {
			if cmd.Process != nil {
				_ = cmd.Process.Signal(os.Interrupt)
			}
		}
	}()

	err = cmd.Wait()
	if err == nil {
		os.Exit(0)
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		code := exitErr.ExitCode()
		if code != 0 {
			fmt.Fprintf(os.Stderr, "WeiDu stopped (exit %d).\n", code)
			pauseWindows()
		}
		os.Exit(code)
	}
	fmt.Fprintf(os.Stderr, "WeiDu could not start: %v\n", err)
	pauseWindows()
	os.Exit(1)
}

func packageRoot() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	return filepath.Abs(filepath.Dir(exe))
}

func fail(err error) {
	fmt.Fprintf(os.Stderr, "WeiDu could not start: %v\n", err)
	pauseWindows()
	os.Exit(1)
}

func pauseWindows() {
	if runtime.GOOS != "windows" {
		return
	}
	fmt.Fprintln(os.Stderr, "Press Enter to close this window.")
	buf := make([]byte, 1)
	_, _ = os.Stdin.Read(buf)
}
