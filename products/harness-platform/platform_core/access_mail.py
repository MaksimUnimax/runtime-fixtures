"""Deliver a single verification message. Credentials are read from a service-owned file."""
from email.message import EmailMessage
import os
from pathlib import Path
import smtplib
import ssl


def deliver(address, code):
    host = os.environ["HARNESS_SMTP_HOST"]
    sender = os.environ["HARNESS_SMTP_FROM"]
    mode = os.getenv("HARNESS_SMTP_MODE", "starttls")
    port = int(os.getenv("HARNESS_SMTP_PORT", "465" if mode == "tls" else "587"))
    context = ssl.create_default_context()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = sender, address, "Код подтверждения Октопорта"
    msg.set_content(f"Ваш код для Октопорта: {code}. Он действует 10 минут.\n"
                    "Если вы не запрашивали код, просто удалите это письмо.")
    if mode == "tls":
        client = smtplib.SMTP_SSL(host, port, timeout=8, context=context)
    elif mode == "starttls" or (mode == "local" and host in {"127.0.0.1", "::1", "localhost"}):
        client = smtplib.SMTP(host, port, timeout=8)
    else:
        raise ValueError("Invalid mail transport configuration")
    with client:
        if mode == "starttls":
            client.starttls(context=context)
        if user := os.getenv("HARNESS_SMTP_USER"):
            if mode == "local":
                raise ValueError("SMTP authentication requires TLS")
            password = Path(os.environ["HARNESS_SMTP_PASSWORD_FILE"]).read_text().rstrip("\r\n")
            client.ehlo()
            if "PLAIN" in client.esmtp_features.get("auth", "").upper().split():
                # This is also supported by the Octoport salted-password mail relay.
                client.user, client.password = user, password
                client.auth("PLAIN", client.auth_plain)
            else:
                client.login(user, password)
        client.send_message(msg)
