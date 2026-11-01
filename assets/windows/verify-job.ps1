# The wrapper joins a non-breakaway job before starting the check. The job handle is not inherited.
# On wrapper exit (normal or stopped through its handle), Windows terminates every descendant.
$ErrorActionPreference = 'Stop'
$taskJobSource = @'
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

public static class SDLCVerifyJob {
    static Task output;
    static Task error;

    public static void Drain(Process command) {
        output = command.StandardOutput.BaseStream.CopyToAsync(Console.OpenStandardOutput());
        error = command.StandardError.BaseStream.CopyToAsync(Console.OpenStandardError());
    }

    public static void Flush() {
        Task.WaitAll(new Task[] { output, error }, 250);
    }

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
    $taskReadyFile = $env:SDLC_VERIFY_READY_FILE
    $taskReadyNonce = $env:SDLC_VERIFY_READY_NONCE
    Remove-Item -LiteralPath Env:SDLC_VERIFY_READY_FILE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath Env:SDLC_VERIFY_READY_NONCE -ErrorAction SilentlyContinue
    Add-Type -TypeDefinition $taskJobSource
    [SDLCVerifyJob]::Attach()
    $taskStart = New-Object System.Diagnostics.ProcessStartInfo
    $taskStart.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
    $taskStart.Arguments = '/d /s /c "' + $env:SDLC_VERIFY_COMMAND + '"'
    $taskStart.UseShellExecute = $false
    $taskStart.CreateNoWindow = $true
    $taskStart.RedirectStandardInput = $true
    $taskStart.RedirectStandardOutput = $true
    $taskStart.RedirectStandardError = $true
    $taskStart.WorkingDirectory = (Get-Location).ProviderPath
    $taskCommand = New-Object System.Diagnostics.Process
    $taskCommand.StartInfo = $taskStart
    if (-not $taskCommand.Start()) {
        throw 'The verification command could not start.'
    }
    $taskCommand.StandardInput.Close()
    [SDLCVerifyJob]::Drain($taskCommand)
    if ($taskReadyFile -and $taskReadyNonce) {
        $taskReady = @{ version = 1; nonce = $taskReadyNonce; wrapper = $PID; started = $true }
        $taskReadyText = ConvertTo-Json -InputObject $taskReady -Compress
        $taskUtf8 = New-Object System.Text.UTF8Encoding($false)
        [System.IO.File]::WriteAllText($taskReadyFile + '.tmp', $taskReadyText, $taskUtf8)
        [System.IO.File]::Move($taskReadyFile + '.tmp', $taskReadyFile)
    }
    $taskCommand.WaitForExit()
    [SDLCVerifyJob]::Flush()
    exit $taskCommand.ExitCode
} catch {
    [Console]::Error.WriteLine('The verification process job could not run.')
    [Console]::Error.WriteLine('Windows verification startup: ' + $_.Exception.Message)
    exit 1
}
