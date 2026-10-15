#!/usr/bin/env python3
"""Build both active containers, verify a purchase-free job, and retire legacy resources."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request

PROJECT = 'lotto-autobuy'
REGION = 'asia-northeast3'
API = 'lotto-autobuy-api'
JOB = 'lotto-purchase-job'
WORKER = 'lotto-purchase-worker'
QUEUE = 'lotto-purchase-queue'
ROOT = Path(__file__).resolve().parent


def cloud(*args, optional=False):
    result = subprocess.run(['gcloud', *args, f'--project={PROJECT}', '--quiet', '--format=json'], capture_output=True, text=True)
    if result.returncode:
        if optional and any(message in result.stderr for message in ('NOT_FOUND', 'does not exist', 'Cannot find service')):
            return None
        # CLI arguments and configuration may contain private data; keep failure output local.
        error_file = STATE / 'gcloud-error.log'
        error_file.write_text(result.stderr)
        raise RuntimeError(f'gcloud {args[0]} {args[1]} failed; details: {error_file}')
    return json.loads(result.stdout) if result.stdout.strip() else None


def save(name, data):
    (STATE / f'{name}.json').write_text(json.dumps(data, indent=2) + '\n')


def log(message):
    print(message, flush=True)


def containers(service):
    return service['spec']['template']['spec']['containers']


def job_spec(job):
    return job['spec']['template']['spec']['template']['spec']


def env_values(container):
    return {entry['name']: entry.get('value', '') for entry in container.get('env', [])}


def wait_build(build):
    name = build['id']
    for _ in range(180):
        result = cloud('builds', 'describe', name, f'--region={REGION}')
        status = result['status']
        if status == 'SUCCESS':
            save('build', result)
            return result
        if status not in ('QUEUED', 'WORKING', 'PENDING', 'STATUS_UNKNOWN'):
            save('failed-build', result)
            raise RuntimeError(f'Container build {name} ended with {status}')
        time.sleep(5)
    raise RuntimeError('Container build exceeded the verification window')


def verify_api(url, revision):
    for _ in range(12):
        try:
            with urllib.request.urlopen(url + '/health', timeout=15) as response:
                health = json.load(response)
            if health.get('revision') == revision and health.get('transport') == 'cloud-run-job' and health.get('nodeVersion', '').startswith('24.'):
                break
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(3)
    else:
        raise RuntimeError('The deployed API did not report the expected Node 24 revision')
    request = urllib.request.Request(url + '/purchase', data=b'{"games":[[1,2,3,4,5,6]],"dryRun":true}', headers={'Content-Type': 'application/json'})
    try:
        urllib.request.urlopen(request, timeout=15)
        raise RuntimeError('The deployed API unexpectedly accepted an unauthenticated request')
    except urllib.error.HTTPError as error:
        if error.code != 401:
            raise
    return health


def cleanup_legacy():
    current = cloud('run', 'services', 'describe', API, f'--region={REGION}')
    config = env_values(containers(current)[0])
    expected_job = f'projects/{PROJECT}/locations/{REGION}/jobs/{JOB}'
    obsolete = {'CLOUD_TASKS_PROJECT_ID', 'CLOUD_TASKS_LOCATION', 'CLOUD_TASKS_QUEUE', 'PURCHASE_WORKER_URL', 'TASK_OIDC_SERVICE_ACCOUNT', 'DIRECT_WORKER_MODE'}
    if config.get('PURCHASE_JOB_NAME') != expected_job or obsolete.intersection(config):
        raise RuntimeError('Refusing cleanup: the API still references legacy resources')
    queue = cloud('tasks', 'queues', 'describe', QUEUE, f'--location={REGION}', optional=True)
    if queue is not None:
        tasks = cloud('tasks', 'list', f'--queue={QUEUE}', f'--location={REGION}')
        if tasks:
            raise RuntimeError('Refusing cleanup: the legacy queue contains pending tasks')
        cloud('tasks', 'queues', 'delete', QUEUE, f'--location={REGION}')
        log('Deleted the empty legacy Cloud Tasks queue.')
    worker = cloud('run', 'services', 'describe', WORKER, f'--region={REGION}', optional=True)
    if worker is not None:
        cloud('run', 'services', 'delete', WORKER, f'--region={REGION}')
        log('Deleted the unused legacy worker service and its revisions.')
    invoker = f'cloud-tasks-invoker@{PROJECT}.iam.gserviceaccount.com'
    accounts = cloud('iam', 'service-accounts', 'list')
    if any(account['email'] == invoker for account in accounts):
        # The active job retains lotto-worker-runtime; only the queue-specific account is retired.
        cloud('iam', 'service-accounts', 'delete', invoker)
        log('Deleted the unused Cloud Tasks invoker service account.')
    policy = cloud('projects', 'get-iam-policy', PROJECT)
    member = f'serviceAccount:lotto-api-runtime@{PROJECT}.iam.gserviceaccount.com'
    if any(binding['role'] == 'roles/cloudtasks.enqueuer' and member in binding.get('members', []) for binding in policy.get('bindings', [])):
        cloud('projects', 'remove-iam-policy-binding', PROJECT, f'--member={member}', '--role=roles/cloudtasks.enqueuer')
        log('Removed the obsolete Cloud Tasks enqueue permission.')


def main():
    api = cloud('run', 'services', 'describe', API, f'--region={REGION}')
    job = cloud('run', 'jobs', 'describe', JOB, f'--region={REGION}')
    for name, value in [('api-before', api), ('job-before', job), ('iam-before', cloud('projects', 'get-iam-policy', PROJECT)), ('job-iam-before', cloud('run', 'jobs', 'get-iam-policy', JOB, f'--region={REGION}'))]:
        save(name, value)
    for name, args in [('worker-before', ('run', 'services', 'describe', WORKER, f'--region={REGION}')), ('queue-before', ('tasks', 'queues', 'describe', QUEUE, f'--location={REGION}'))]:
        save(name, cloud(*args, optional=True))
    spec = job_spec(job)
    old_job_image = cloud('artifacts', 'docker', 'images', 'describe', spec['containers'][0]['image'])['image_summary']['fully_qualified_digest']
    save('job-image-before', {'image': old_job_image})
    if api['spec']['template']['spec']['serviceAccountName'] != f'lotto-api-runtime@{PROJECT}.iam.gserviceaccount.com':
        raise RuntimeError('Unexpected API service account; review deployment configuration')
    if job.get('status', {}).get('runningExecutionsCount', 0):
        raise RuntimeError('A purchase job is currently running; retry after it finishes')
    old_env = env_values(containers(api)[0])
    required = ('ALLOWED_EMAIL', 'GOOGLE_OAUTH_CLIENT_ID', 'PURCHASE_JOB_NAME', 'PURCHASE_CALLBACK_URL')
    if any(not old_env.get(name) for name in required):
        raise RuntimeError('The active purchase configuration is incomplete')
    api_env = {name: old_env[name] for name in required}
    api_env.update(ALLOWED_ORIGINS=old_env.get('ALLOWED_ORIGINS', 'https://lottoforunluckypeople.netlify.app'), PURCHASE_REQUEST_TIMEOUT_MS='240000')
    save('api-env', api_env)
    log(f'Rollback configuration: {STATE}')
    if not ARGS.apply:
        log('Preflight passed. Use --apply to deploy; add --cleanup-legacy to retire unused resources.')
        return

    tag = 'node24-' + dt.datetime.now(dt.timezone.utc).strftime('%Y%m%d%H%M%S')
    staging = f'gs://{PROJECT}_cloudbuild/source'
    build = cloud('builds', 'submit', str(ROOT), f'--region={REGION}', f'--config={ROOT / "cloudbuild.yaml"}', f'--substitutions=_REGION={REGION},_TAG={tag}', f'--gcs-source-staging-dir={staging}', '--async')
    log(f'Building both Node 24 containers on the regular worker release: {build["id"]}')
    build = wait_build(build)
    images = {image['name'].split('/')[-1].split(':')[0]: image['name'].split(':')[0] + '@' + image['digest'] for image in build['results']['images']}
    try:
        cloud('run', 'jobs', 'update', JOB, f'--region={REGION}', f'--image={images[JOB]}', '--remove-env-vars=BROWSER_NAVIGATION_TIMEOUT_MS', '--update-env-vars=PURCHASE_HTTP_TIMEOUT_MS=60000', '--max-retries=0', '--task-timeout=120s', '--tasks=1', '--parallelism=1', '--cpu=1', '--memory=512Mi')
        log('Updated the job. Running its purchase-free self-test.')
        execution = cloud('run', 'jobs', 'execute', JOB, f'--region={REGION}', '--args=--self-test', '--wait')
        save('job-self-test', execution)
    except Exception:
        cloud('run', 'jobs', 'update', JOB, f'--region={REGION}', f'--image={old_job_image}')
        raise

    old_revision = api['status']['latestReadyRevisionName']
    try:
        cloud('run', 'deploy', API, f'--region={REGION}', f'--image={images[API]}', '--clear-base-image', f'--env-vars-file={STATE / "api-env.json"}', f'--service-account=lotto-api-runtime@{PROJECT}.iam.gserviceaccount.com', '--min-instances=0', '--max-instances=1', '--cpu=1', '--memory=512Mi', '--concurrency=10', '--timeout=300', '--cpu-throttling')
        updated = cloud('run', 'services', 'describe', API, f'--region={REGION}')
        health = verify_api(updated['status']['url'], updated['status']['latestReadyRevisionName'])
        log(f'API verified: Node {health["nodeVersion"]}, {health["revision"]}; unauthenticated purchase requests are rejected.')
    except Exception:
        cloud('run', 'services', 'update-traffic', API, f'--region={REGION}', f'--to-revisions={old_revision}=100')
        cloud('run', 'jobs', 'update', JOB, f'--region={REGION}', f'--image={old_job_image}')
        raise
    if ARGS.cleanup_legacy:
        cleanup_legacy()
    for name, image in images.items():
        cloud('artifacts', 'docker', 'tags', 'add', image, image.split('@')[0] + ':latest')
    if ARGS.cleanup_legacy and old_job_image != images[JOB]:
        cloud('artifacts', 'docker', 'images', 'delete', old_job_image, '--delete-tags')
        log('Deleted the superseded Node 20 job image after verifying the replacement.')
    final_job = cloud('run', 'jobs', 'describe', JOB, f'--region={REGION}')
    services = cloud('run', 'services', 'list', '--platform=managed')
    queues = cloud('tasks', 'queues', 'list', f'--location={REGION}')
    save('report', {
        'completedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'project': PROJECT,
        'buildId': build['id'], 'workerRelease': build.get('options', {}).get('workerRelease'),
        'apiHealth': health, 'images': images,
        'jobSelfTest': 'passed', 'jobServiceAccount': job_spec(final_job).get('serviceAccountName'),
        'remainingServices': [service['metadata']['name'] for service in services],
        'remainingQueues': [queue.get('name') for queue in queues], 'legacyCleanupRequested': ARGS.cleanup_legacy,
        'supersededJobImageRemoved': ARGS.cleanup_legacy and old_job_image != images[JOB],
    })
    log(f'Completed. Verification report: {STATE / "report.json"}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--cleanup-legacy', action='store_true')
    ARGS = parser.parse_args()
    os.umask(0o077)
    STATE = Path.home() / '.local/state/lotto-generator-web/cloud-maintenance' / dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    STATE.mkdir(parents=True, exist_ok=True)
    main()
