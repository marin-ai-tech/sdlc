# The wrapper joins a non-breakaway job before starting the check. The job handle is not inherited.
# On wrapper exit (normal or stopped through its handle), Windows terminates every descendant.
$ErrorActionPreference = 'Stop'
$taskJobSource = @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class SDLCVerifyJob {
    [StructLayout(LayoutKind.Sequential)]
    struct Limits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinimumWorkingSet, MaximumWorkingSet;
        public uint ActiveProcesses;
        public UIntPtr Affinity;
        public uint Priority, Scheduling;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct Counters {
        public ulong ReadOperations, WriteOperations, OtherOperations;
        public ulong ReadBytes, WriteBytes, OtherBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimits {
        public Limits Basic;
        public Counters IO;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr attributes, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref ExtendedLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll")]
    static extern IntPtr GetCurrentProcess();

    public static void Attach() {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        ExtendedLimits limits = new ExtendedLimits();
        limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(limits)))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (!AssignProcessToJobObject(job, GetCurrentProcess()))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        // Intentionally keep the raw handle open until this wrapper exits. Child processes cannot inherit it.
    }
}
'@

try {
    Add-Type -TypeDefinition $taskJobSource
    [SDLCVerifyJob]::Attach()
    & $env:ComSpec /d /s /c $env:SDLC_VERIFY_COMMAND
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('The verification process job could not run.')
    exit 1
}
