"""Exclusive locks whose lifetime follows the open file on every host OS."""
import os
import time

LOCK_EX, LOCK_NB, LOCK_UN = 2, 4, 8

if os.name == 'nt':
    import msvcrt

    def flock(file, operation):
        # All Suite callers use exclusive locks. Lock byte zero, leaving the
        # caller's file position unchanged (these files may also hold JSON).
        position=file.tell()
        try:
            while True:
                file.seek(0)
                try:
                    msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK if operation & LOCK_UN else msvcrt.LK_NBLCK, 1)
                    return
                except OSError as error:
                    if operation & (LOCK_NB | LOCK_UN):
                        raise BlockingIOError(str(error)) from error
                    time.sleep(.05)
        finally:
            file.seek(position)
else:
    from fcntl import flock
