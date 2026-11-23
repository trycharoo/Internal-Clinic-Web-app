# Internal Clinic Web App

A root-level React demo of an internal clinic workspace for walk-ins, appointments, patient charts, and prescription drafts, paired with a lightweight Node document-parser proxy in `backend/` and a FastAPI parser service in `services/doc-parser/`. Patient, appointment, and queue data is stored in the current browser with `localStorage`; there is no database, container stack, or authentication.

## Prerequisites

- Git
- Node.js `22.22.2+` in the Node 22 line, Node.js `24.15+` in the Node 24 line, or Node.js `26+`
- npm
- Python 3 (optional; only needed if running `services/doc-parser` tests locally)

Install Git from [git-scm.com](https://git-scm.com/downloads) and Node.js from [nodejs.org](https://nodejs.org/en/download). Check the installations with:

```sh
git --version
node --version
npm --version
```

## Run locally

Clone the repository and install dependencies:

```sh
git clone https://github.com/trycharoo/Internal-Clinic-Web-app.git
cd Internal-Clinic-Web-app
npm ci
```

Start the development server:

```sh
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

Document uploads also need the backend proxy running with `npm start --prefix backend` from the repository root. Create a local environment file from `.env.example` and configure the parser URL and server-only key:

```sh
cp .env.example .env
```

Set `DOC_PARSER_URL` and `DOC_PARSER_API_KEY` in `.env`; these values stay on the server and must never use a `VITE_` prefix.

## Build and preview

```sh
npm run build
npm run preview
```

## Demo login

With the default frontend dev server, open [http://localhost:5173/login](http://localhost:5173/login). If the server uses another port, use that port with `/login`.

The current Conductor workspace preview is [http://127.0.0.1:55020/login](http://127.0.0.1:55020/login). It runs on a dedicated port because another local service is using `5173`. To launch this workspace on that alternate port, run from the repository root:

```sh
npm run dev -- --host 127.0.0.1 --port 55020 --strictPort
```

Select the matching role and enter its public sample credentials:

| Role | Email | Password | Demo route |
| --- | --- | --- | --- |
| Doctor | `doctor@northstar.demo` | `DoctorDemo123!` | `/demo/doctor` |
| Attendant / Secretary | `secretary@northstar.demo` | `StaffDemo123!` | `/demo/attendant` |
| Patient | `patient@northstar.demo` | `PatientDemo123!` | `/demo/patient` |

Email comparison ignores case and surrounding whitespace; passwords must match exactly. Incorrect credentials or a role mismatch stay on `/login`. **Explore demo workspace** is an explicit shortcut to the Doctor sandbox.

These are public demo credentials, not real accounts. Doctor opens the clinical workspace; Attendant opens reception, registration, booking, triage, and existing-intake controls; Patient opens welcome/check-in guidance without staff or other-patient data. The demo selection exists only in memory: refreshing or opening a demo route directly without an active selection returns to `/login`. **Log in as** returns to `/login`; public `?queue=` check-in links remain accountless. The credentials and demo selection are not saved in browser storage, while synthetic clinic records retain their existing browser-local persistence.

**Change cover** previews your own JPEG, PNG, or WebP up to 5 MiB until refresh; **Reset cover** restores the bundled image. See the [hero asset guide](public/images/README.md) to replace the default cover.

## Requirements and workflow

The [software requirements specification](docs/SRS.md) defines the proposed walk-in workflow: reception confirms or registers a patient, records triage, queues the visit for the doctor, and retains the consultation and prescriptions in the patient history. It includes requirement IDs, acceptance scenarios, and a matrix showing which behaviors exist in the demo and which still need shared database and backend implementation. The document parser's service contract and deployment notes are in [services/doc-parser](services/doc-parser/README.md).

The [Philippines EHR deployment readiness plan](docs/DEPLOYMENT_READINESS.md) reviews current blockers, adds clinical and privacy standards as release criteria, and orders the work needed before the clinic can use real patient records.

## Tests and CI/CD

Contributions must follow the repository-wide [testing policy in AGENTS.md](AGENTS.md): every new feature or behavior change includes meaningful unit tests, and every bug fix includes a regression test. Documentation-only changes do not require runtime tests. [Testing](docs/TESTING.md) provides the check commands and prerequisites.

Run the checks from the repository root:

```sh
npm ci
npm run typecheck
npm run test:coverage
npx playwright install chromium
npm run test:e2e
npm test --prefix backend
python3 -m pip install -r services/doc-parser/requirements-dev.txt
python3 -m pytest services/doc-parser/test_app.py
```

The browser suite builds and type-checks the app, then tests desktop and mobile Chromium against a production preview. See [testing](docs/TESTING.md) for commands, reports, CI jobs, and the review–resolve–iterate process. Configure repository branch protection to require the CI checks before merging.

## Current demo limitations

- The backend currently provides only the document-parser proxy. There is no database, container stack, or server-backed clinical persistence in this repository.
- The document parser runs on the supplied InstaBox and may pause under its free-plan runtime limits. Its URL can wake an idle box, but this is a trial integration, not an always-on production deployment.
- Patient, appointment, and queue demo data is stored in browser `localStorage`. Queue check-ins do not synchronize between different browsers or devices.
- Public sample credentials select browser-only role views; real authentication, server-enforced roles, server-backed triage/visit transitions, and audit history remain planned. The local connected encounter and its prescription output remain a demo draft, not a finalized clinical record.

Do not use real patient data or production credentials in this demo.
