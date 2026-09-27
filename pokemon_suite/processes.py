"""Process inspection without signal-based termination on Windows."""
import os


def assert_process_alive(pid):
    if type(pid) is not int or pid<=1:raise ValueError('Invalid owner process identifier.')
    if os.name!='nt':
        os.kill(pid,0)
        return
    import ctypes
    from ctypes import wintypes
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.argtypes=[wintypes.DWORD,wintypes.BOOL,wintypes.DWORD]
    kernel.OpenProcess.restype=wintypes.HANDLE
    kernel.WaitForSingleObject.argtypes=[wintypes.HANDLE,wintypes.DWORD]
    kernel.WaitForSingleObject.restype=wintypes.DWORD
    kernel.CloseHandle.argtypes=[wintypes.HANDLE]
    handle=kernel.OpenProcess(0x00100000,False,pid) # SYNCHRONIZE, read-only process lifetime
    if not handle:
        error=ctypes.get_last_error()
        if error==87:raise ProcessLookupError(pid)
        raise PermissionError(error,'Cannot inspect the game owner.')
    try:
        state=kernel.WaitForSingleObject(handle,0)
        if state==0:raise ProcessLookupError(pid)
        if state!=258:raise OSError(ctypes.get_last_error(),'Cannot inspect the game owner.')
    finally:
        kernel.CloseHandle(handle)
