# Personal tools

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Anders uses the personal GitHub Pages site to find his own projects and tools.
The fleet analytics workspace is restricted to his verified Google account,
andershaf@gmail.com, by the backend.

## Product Purpose

Keep personal tools accessible and provide one place to investigate usage across
Anders's apps, replacing fragmented Mixpanel dashboards with first-party analytics.

## Operating Context

The existing site is plain static HTML/CSS/JavaScript on GitHub Pages.
Analytics data lives in a separate service and dedicated Firestore database.
Fuse Games' first-party explorer supplies the behavioral reference: visible
filters, raw-event inspection, session timelines and explicit completeness limits.

## Capabilities and Constraints

Public source and static assets must contain no private telemetry or credentials.
Only a verified Google session with the exact allowed email may read analytics.
Migration inventory distinguishes existing instrumentation from planned coverage.
Historical Mixpanel data is not assumed to have been imported.

## Evidence on Hand

The existing visual system is in assets/style.css. The analytics inventory records
source repositories, inspected revisions, events, migration status and next actions.
Any preview fixtures must be clearly labeled synthetic and kept out of production.

## Analytics priorities

Anders prioritizes DAU, MAU, session counts and event counts, with histograms,
graphs and exploratory deepdives. DAU is the selected end date; MAU is that
calendar month through the selected end date. Instrumentation changes must
reconcile each app's published privacy promises.
