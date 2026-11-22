"""Local operator binds trusted addresses before the first administrator sign-in."""
import argparse
import sqlite3
from pathlib import Path

from .account_access import SCHEMA, mailbox
from .identity import _login_name


def assign(db, login, email):
    actor = db.execute("SELECT actor_id FROM identity_accounts WHERE login=?", (_login_name(login),)).fetchone()
    if not actor:
        raise ValueError("Unknown login")
    if not db.execute("SELECT 1 FROM identity_admins WHERE actor_id=?", actor).fetchone():
        raise ValueError("This command only bootstraps an administrator")
    current = db.execute("SELECT email,verified FROM access_contacts WHERE actor=?", actor).fetchone()
    email = mailbox(email)
    if current:
        if current[0] != email:
            raise ValueError("An address is already assigned to this account")
        return
    db.execute("INSERT INTO access_contacts(actor,email) VALUES(?,?)", (actor[0],email))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", required=True, type=Path)
    parser.add_argument("--login", required=True)
    parser.add_argument("--email", required=True)
    args = parser.parse_args()
    # Preflight can run before the rollout. Do not activate the session migration in this CLI.
    with sqlite3.connect(args.db.resolve().as_uri()+"?mode=rw", uri=True) as db:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("BEGIN IMMEDIATE")
        db.execute(SCHEMA[0])
        assign(db, args.login, args.email)


if __name__ == "__main__":
    main()
