# How we use AI in the codebase

We use Claude Code, an AI coding assistant, as a pair programmer. The team decides what MATCHPOINT is, how it behaves and what it looks like. The AI writes code to those decisions, and we review, test and commit it ourselves.

Team: Olaiwon (backend), Ayomide (ML and UI), Abdulhaqeem (product). This log covers the AI-assisted work done in Ayomide's sessions.

Day 1 (20 October)
## General
 - Set up the monorepo, scripts for deployment and packages
 - We chose the structure: one repo with a web app and an API that can each be deployed on their own. The AI scaffolded it to that brief (pnpm workspace, Python project, Render blueprint, CI that only rebuilds what changed).

 ## Frontend
 - No frontend work yet. The web app was started on Day 2.

 ## API design
 - The API design (`docs/api_design.md`) was written by the team: Olaiwon wrote it and Ayomide edited it. The design covers the endpoints, the data shapes, the reason codes and the 10-step decision pipeline. All later AI work was built against this document.

Day 2 (21 October)
## Frontend
 - **Pages.** We decided the pages: a home page, customer sign-in and sign-up, and a customer page with an on-screen phone and controls for each endpoint. We also set the first colour scheme (black, green and white). The AI built them to that brief.
 - **Simplicity.** We reviewed the first version and found it too technical for a normal user. Judges score simplicity and ease of use, so we directed a plain-language interface. The AI rewrote labels and added a "Developer view" switch, which hides endpoints, codes and IDs unless it is turned on.
 - **Copy.** From our screenshot reviews, we asked for the app to read like a real tool, not a pitch. The pitch lives in our slides. The AI removed explanatory and selling sentences.
 - **Backend integration.** As Olaiwon pushed endpoints, we told the AI which ones were ready and asked it to connect them. The app calls the real API first. For routes that are not built yet, it falls back to an in-browser mock, so the demo keeps working.
 - **Look and feel.** We made the design calls and the AI applied them:
   - add a touch of red;
   - a shorter, centred nav underline;
   - red, black and white as the main colours;
   - green brought back for success states;
   - mobile-friendly layouts.
 - **Zenith products.** We supplied Zenith Bank Nigeria's confirmed product list. The AI rebuilt the demo catalogue on it, with features described generically: no invented interest rates or terms, and illustrative figures labelled as illustrative. We limited the change to the web app so it would not clash with backend work.
 - **Banking-app redesign.** Ayomide designed the new customer layout, based on our view that customers open their bank app far more often than they read offer SMSs. It is a bank-account screen with balance and transaction history. Demo buttons trigger account activity (salary arriving, school fees, POS sales, bills, dollar payments). The recommendation appears in the app with why it was chosen and what the customer gains. The AI built it, and the inbox was kept.
 - **Error messages.** We asked that errors show developers everything they need (status, code, failing request, trace ID) and show customers a plain sentence only. The AI made that change.

## Backend
 - The codebase was developed using pair programming with claude code(AI assistance), with all code reviewed and guided by an experienced backend developer

Day 3 (22 October)
## Frontend
 - From a screenshot review, we found you had to scroll to the bottom tab bar to leave a screen on the phone. We asked for a back button at the top, and the AI added it.

## Deployment
 - We asked whether the backend needed changes before deploying. The AI found that moving the backend to Zenith's products was backend work. We decided to tell Olaiwon rather than have the AI edit the backend, and Olaiwon had already started on it.
 - We decided to deploy the backend on Vercel for now. The AI found that the latest backend commits, which are still in progress, break the decision endpoint. It also found they add dependencies too large for Vercel. Rather than change a teammate's unfinished code, the AI deployed the last working version from a separate branch (`deploy/vercel-api`). It only added a small entry file for Vercel, and it pushed that branch at our request. We configured Vercel ourselves.
 - The AI found that our first deploy URL was behind Vercel's login wall and that production was still building the broken branch. We fixed the settings.

## How we keep our AI use responsible
 - **Humans decide.** Product scope, API design, screens, features, colours and copy all came from the team. The AI proposes and implements.
 - **We verify before we trust.** Each change was checked:
   - type checks and builds;
   - automated browser runs of the demo stories;
   - a scan that no codes or IDs show to non-technical users;
   - mobile layout checks;
   - backend tests.
   Failures were reported to us as they were, including the broken decision endpoint above.
 - **Nothing ships without us.** We commit and push our own work. The one push the AI made was a separate deploy branch, at our request, and it never pushed to `main`.
 - **We respect ownership.** The AI did not edit a teammate's in-progress code. Backend needs were written down for the backend owner instead.
 - **No misleading content.** The AI only shows a Zenith product name where the product genuinely matches, and it does not invent rates or terms. When an alias made one product look like another, it was reverted.
 - **Data and privacy.** Only synthetic data is used: simulated customers and transactions, with no real customer data and no secrets in the code. Customers must consent before personalised offers. The decision engine ignores sensitive spending such as betting.
