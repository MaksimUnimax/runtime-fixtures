# Фактические S03 stage процедуры · 2026-11-05

Снимки конечных процедур, выполненных после явного допуска владельца. SHA256 всех13файлов совпал с фактически использованными server scripts. Это доказательства выполнения, а не новый планировщик/runner или разрешение повторять операции.

[План](../AL_S03_STAGE_ROLLOUT_20261105.md) · [Полные результаты и история остановок](../AL_S03_INSTALLED_EVIDENCE_20261105.json) · [Независимый вердикт](../AL_S03_INSTALLED_INDEPENDENT_REVIEW_20261105.json) · [Отчёт](../AL_S03_INSTALLED_REPORT_20261105.md).

`install.py`/`install-retry.py` сохраняют private snapshots и устанавливают exact bytes. `activate.py`/`activate-resume.py`/`activate-final.py` фиксируют последовательное продолжение после выясненного исхода, без повторной migration/rotation. `smoke*.py` сохраняют первоначальные неуспехи и квалификацию тех же native identities/factors. `rollback.py` фиксирует27пройденных шагов и прерывание на reload503; `reentry.py` отдельно завершает свежий nativeTOTP и отзыв старых данных. `final-checks*.py` проверяют manifest, privacy, permissions и исключённые пути.

Файлы содержат только статические stage paths/config names. Закрытые config, bootstrap JSON, OTP/recovery, cookie states, client secrets, письма и DB dumps не опубликованы. Runtime/package source не изменялся. Перед новыми действиями требуется текущий readback: после выполнения другой поток сменил web/API/identity наdd2; текущая комбинация не принята. При недостатке ресурса или неизвестном исходе зависимое действие прекращается.
