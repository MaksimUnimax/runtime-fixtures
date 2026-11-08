"""Estimated speech time for Station jobs; based on locally observed completions."""
import math


def baseline(history):
    values = sorted(x for x in history[-20:] if type(x) in (int, float) and 1 <= x <= 86400)
    if len(values) < 3:
        return 60
    observed = values[math.ceil(len(values) * .75) - 1]
    return max(30, min(900, math.ceil(observed / 10) * 10))


def remaining(job, now):
    deadline = job.setdefault('eta_until', job['created'] + job.get('eta_base', 60))
    # An overrun must not produce "zero seconds left". Move the estimate forward,
    # while preserving the fact that it is only an estimate.
    if deadline <= now:
        step = max(60, job.get('eta_base', 60))
        job['eta_until'] = deadline + math.ceil((now - deadline + 1) / step) * step
    return max(10, math.ceil((job['eta_until'] - now) / 10) * 10)


def label(seconds):
    if seconds >= 100:
        return f'{math.ceil(seconds / 60)} минут'
    if seconds >= 60:
        return 'минуты'
    return f'{seconds} секунд'


def pending(message, job, now):
    phrase = 'около ' + label(remaining(job, now))
    if '{remaining}' in message:
        return message.replace('{remaining}', phrase)
    return message.rstrip(' .') + '. Ориентировочно осталось ' + phrase + '.'


def observe(history, duration):
    if 1 <= duration <= 86400:
        history.append(round(duration))
        del history[:-20]