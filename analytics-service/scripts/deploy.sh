#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
revision="$(git rev-parse HEAD)"
if [[ -n "$(git status --porcelain -- . ../stats)" ]]; then
  echo 'Commit analytics and stats changes before deployment.' >&2
  exit 1
fi
image="europe-west1-docker.pkg.dev/andershaf-87/fuse-riders/personal-analytics:$revision"
analytics_env='GOOGLE_CLOUD_PROJECT=andershaf-87,FIRESTORE_DATABASE_ID=personal-analytics,ALLOWED_ORIGINS=https://andeplane.github.io,FUSE_SOURCE_ENABLED=1'
if [[ -n "${ENABLE_WAREHOUSE:-}" ]]; then
  analytics_env+=",WAREHOUSE_ENABLED=$ENABLE_WAREHOUSE"
fi
gcloud builds submit . --config=scripts/cloudbuild.yaml \
  --substitutions="_IMAGE=$image" --project=andershaf-87 --region=europe-west1 \
  --service-account=projects/andershaf-87/serviceAccounts/fuse-riders-build@andershaf-87.iam.gserviceaccount.com \
  --gcs-source-staging-dir=gs://andershaf-87-fuse-riders-build/personal-analytics-source \
  --account=andershaf@gmail.com --quiet
gcloud run deploy personal-analytics --image="$image" \
  --project=andershaf-87 --region=europe-west1 --account=andershaf@gmail.com \
  --service-account=personal-analytics-runtime@andershaf-87.iam.gserviceaccount.com \
  --min=0 --max=2 --min-instances=0 --max-instances=2 --concurrency=40 --cpu=1 --memory=512Mi \
  --timeout=30 --allow-unauthenticated \
  --update-env-vars="$analytics_env" \
  --set-secrets=ANALYTICS_PRIVACY_SECRET=personal-analytics-privacy:1 \
  --labels="component=personal-analytics,commit=$revision" --quiet
gcloud run services describe personal-analytics --project=andershaf-87 \
  --region=europe-west1 --account=andershaf@gmail.com \
  --format='json(status.url,status.latestReadyRevisionName,status.traffic)'
gcloud run jobs deploy personal-analytics-sync --image="$image" \
  --project=andershaf-87 --region=europe-west1 --account=andershaf@gmail.com \
  --service-account=personal-analytics-importer@andershaf-87.iam.gserviceaccount.com \
  --command=node --args=src/sync-job.js --tasks=1 --parallelism=1 --max-retries=0 \
  --cpu=1 --memory=1Gi --task-timeout=3600 --quiet
gcloud run jobs deploy personal-analytics-import --image="$image" \
  --project=andershaf-87 --region=europe-west1 --account=andershaf@gmail.com \
  --service-account=personal-analytics-importer@andershaf-87.iam.gserviceaccount.com \
  --command=node --args=src/import-job.js --tasks=1 --parallelism=1 --max-retries=0 \
  --cpu=1 --memory=1Gi --task-timeout=86400 --quiet
