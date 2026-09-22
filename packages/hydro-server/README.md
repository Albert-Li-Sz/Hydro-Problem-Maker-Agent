# Hydro server

Small HTTP boundary for validating a structured problem and downloading its deterministic Hydro import ZIP.

```bash
npm run dev --workspace=@hydro-problem-make/server
```

The default listener is `http://127.0.0.1:4321`. Set `HYDRO_WEB_ROOT` to a built web directory when the server should also serve the frontend.

The web settings page uses `GET`, `PUT`, and `DELETE /api/ai/config`. The `provider` field selects one of `openai-completions`, `openai-responses`, and `anthropic-messages`; `modelId` is a freely entered API model ID. Configure an API key and optional Base URL. Existing provider configurations migrate to a protocol using their model metadata. The default local file is `.hydro-problem-make/ai-config.json`; override it with `HYDRO_AI_CONFIG_PATH`. Saving configuration updates Agent availability immediately and does not send a model request.

Set `HYDRO_ENABLE_AGENT=1` to use credentials already configured for Pi instead of the local web configuration. Optional `HYDRO_MODEL_PROVIDER` and `HYDRO_MODEL_ID` values select one available model. The server stays available with deterministic validation and packaging if no model is configured.

`POST /api/runs` accepts `{ source, referenceProgram?: { language, code } }`. `POST /api/runs/:id/continue` accepts `{ message, referenceProgram? }` for waiting, failed, or cancelled tasks. It preserves the run ID and conversation. The manager runs two independent workflows concurrently by default and queues further work; set `HYDRO_MAX_CONCURRENT_RUNS` to an integer from 1 to 8 to change the limit. `GET /api/runs/:id/archive` downloads a completed package. Snapshots and events persist in `.hydro-problem-make/runs.json`; interrupted tasks await an explicit continuation after restart.

`GET /api/runs/:id/authoring` downloads the source project and validation evidence for new testlib authoring runs. `DELETE /api/runs/:id` deletes a terminal record and its local artifact/session directories; active or still-exiting tasks return 409. Other tasks and the AI configuration are retained.

`POST /api/sandbox/run` accepts `{ program: { language, code }, cases: [{ input, expectedOutput? }], timeLimitMs?, memoryLimitMb? }`. Languages are `cpp17`, `python3`, and `java`. Empty input is supported; omitting expectedOutput generates an answer instead of comparing. The health response includes Docker sandbox availability. See [sandbox setup](../hydro-agent/README.md).
