# Quran ASR Cloud Run backend

This service uses `wasimlhr/whisper-quran-v1` (Whisper Large-v3, CC-BY-NC-4.0)
for this project's confirmed non-commercial use. It transcribes a temporary
audio upload in memory/temp storage, aligns it against the expected Quran words,
returns structured word feedback, and deletes the temporary files immediately.

## Local test

```sh
cd quran-asr-backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
REQUIRE_FIREBASE_AUTH=false uvicorn app:app --host 0.0.0.0 --port 8080
pytest
curl http://localhost:8080/health
```

The first start downloads several GB of model weights and needs a machine with
at least 12 GB available RAM for CPU inference. Docker test:

```sh
docker build -t quran-asr .
docker run --rm -p 8080:8080 -e REQUIRE_FIREBASE_AUTH=false quran-asr
```

## Cloud Run proposal — do not run until project and billing are confirmed

Use only project `ihfad-2fecd`, never the unrelated local gcloud default.

```sh
gcloud config set project ihfad-2fecd
gcloud config get-value project
gcloud services enable run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com
gcloud builds submit --tag me-central1-docker.pkg.dev/ihfad-2fecd/quran-asr/quran-asr:latest
gcloud run deploy quran-asr --image me-central1-docker.pkg.dev/ihfad-2fecd/quran-asr/quran-asr:latest --region me-central1 --cpu 4 --memory 16Gi --concurrency 1 --timeout 60 --min-instances 0 --set-env-vars REQUIRE_FIREBASE_AUTH=true,CORS_ORIGINS=https://mayadin-kw.github.io
```

`me-central1` (Doha) is proposed for Kuwait/Gulf latency. CPU is the first
deployment target. If measured CPU latency is unacceptable, use a Cloud Run GPU
region after an explicit cost/latency review; GPU availability is regional.

Before the public frontend is pointed at this service, configure Firebase Auth
and grant the Cloud Run runtime service account permission to verify Firebase ID
tokens. The service intentionally rejects unauthenticated requests by default.

## API

`POST /api/recitation/check` accepts multipart audio plus `surah`, `ayah`,
`verseKey`, `segmentStartWord`, `segmentEndWord`, `expectedText`, and JSON
`expectedWords`. It permits only supported audio, a 30-second maximum, 8 MB
maximum payload, configured origins, and a per-instance rate limit. It does not
save audio or log raw recordings.
