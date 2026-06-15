import subprocess

ERROR_LOG = "/tmp/com.user.autopilot.err"
OUTPUT_LOG = "/tmp/com.user.autopilot.out"


def send_os_notification(title, message):
    try:
        safe_title = title.replace('"', '\\"')
        safe_message = message.replace('"', '\\"')
        apple_script = f'display notification "{safe_message}" with title "{safe_title}" sound name "Glass"'
        result = subprocess.run(
            ["osascript", "-e", apple_script],
            capture_output=True, text=True
        )
        with open(OUTPUT_LOG, "a") as f:
            if result.returncode == 0:
                f.write(f"[NOTIFICATION SENT] title='{safe_title}'\n")
            else:
                f.write(f"[NOTIFICATION FAILED] code={result.returncode} err='{result.stderr.strip()}'\n")
                with open(ERROR_LOG, "a") as e:
                    e.write(f"osascript error (code {result.returncode}): {result.stderr}\n")
    except Exception as e:
        with open(ERROR_LOG, "a") as f:
            f.write(f"Notification Error: {str(e)}\n")


class DesktopNotifier:
    send_notification = staticmethod(send_os_notification)
