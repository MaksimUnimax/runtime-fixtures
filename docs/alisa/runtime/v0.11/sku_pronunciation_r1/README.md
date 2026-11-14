# SKU pronunciation in the existing voice answer instruction

An owner heard the acronym as a word. The latest numerical answer contains Latin SKU; the active Dialogs response builder copies its text into tts without a separate pronunciation. The retained per-request transcript contains that Latin acronym, not the requested letter names. Raw outbound historic audio/TTS was not retained, so acoustic replay is not claimed.

Append one rule to the existing global answer_prompt: write SKU for voice as the Russian letter names эс ка ю, exactly as the owner specified. Preserve the entire current prompt as a prefix, planning prompt and extra instruction. Use existing revision-checked IPC settings save; do not patch model results, calculations, source templates, access, skill transport or Station. No restart is required. A real identical question and its final transcript must confirm compliance; a probabilistic prompt is not an acoustic guarantee.

Installer pins revision4 and file/change hashes, locks runtime recovery, blocks active work/clarifications, saves an owned backup, checks exact native readback, and reconciles ambiguous save results read-only without resubmitting. Source runtime and configuration are verified unchanged. Existing settings/model-answer tests are rerun without paid calls.
