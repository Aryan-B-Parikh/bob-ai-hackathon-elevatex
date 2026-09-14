# Problem Statement — L1: Container Congestion Predictor & Port Operations Optimiser

**Sector:** Logistics & Ports
**Severity tag:** Critical Now
**Setting:** San Pedro Bay — the twin Ports of Long Beach (POLB) and Los Angeles (POLA), the largest container gateway in the Western Hemisphere.

---

## 1. Context: the 2021 San Pedro Bay backlog

In late 2021 the San Pedro Bay complex experienced the most visible supply-chain failure of the pandemic era:

- **100+ container ships waited offshore for weeks.** The Southern California Marine Exchange vessel queue — the official count of ships at anchor or drifting in the San Pedro Bay queue — climbed from a handful of vessels in mid-2021 to a peak of roughly **109 ships** in January 2022, with dozens of vessels routinely waiting 2–4 weeks before a berth opened.
- **An estimated $10B+ in supply-chain impact.** The backlog rippled through inland distribution: empty containers stranded in Asia, chassis shortages, warehouse overflow, and holiday inventory shortfalls across the US economy; the anchorages themselves became a floating warehouse holding hundreds of thousands of TEU of deferred cargo.
- **The queue was managed the way it had always been managed.** Vessel arrivals, anchorage assignments, berth windows, crane gangs and yard plans were tracked in spreadsheets and updated by phone — hundreds of vessels against ~80 POLB berths and dozens of terminal operations, all asynchronous.

The structural problem was not a lack of capacity on paper — POLB alone operates 80 berths across 10 piers with 71 post-Panamax gantry cranes — it was that **no single operator view existed** connecting three things that are tightly coupled: *who is arriving and when* (vessel schedules), *what the infrastructure can absorb* (berth/crane capacity), and *what the congestion actually looks like right now and next* (queue behaviour).

## 2. Stakeholder pain

**Port / marine terminal operators**

- **Manual berth planning.** Berth allocation and crane assignment are worked out in spreadsheets, vessel by vessel. A single ULCV discharge plan can be 10,000+ moves; juggling 30–40 concurrent calls by hand means the plan is stale the moment a vessel slips.
- **Reactive hotspot discovery.** Congestion is noticed *after* vessels start stacking at a terminal — the queue has already formed before anyone re-balances. There is no 72-hour warning that Pier J or Pier E is about to saturate.
- **Late routing decisions.** Diversion to Oakland, Seattle-Tacoma, Prince Rupert or Ensenada is only evaluated once the wait is already known and unacceptable — at which point the economics are mostly sunk. Timely divert / slow-steam decisions (before the last leg) save real money: a large container ship costs on the order of **$32,000/day** to operate while it waits.

**Vessel operators / carriers**

- Long anchorage waits burn fuel and crew time, cascade into downstream port rotations, and stress time-sensitive cargo — refrigerated containers need power and timely discharge, with spoilage risk growing by the hour.

**Shift supervisors**

- Handover between the 6-hour shifts is verbal + spreadsheet; arrivals, berthings, crane moves, congestion alerts and routing decisions live in separate places. A single fused plan with a checklist does not exist today.

**Consequences of inaction:** queues form reactively, cranes and berths idle while ships wait offshore elsewhere in the bay, expensive vessels anchor for weeks, and alternates are chosen too late to help.

## 3. The challenge — exactly four items

The hackathon brief (master guide §1) requires building **exactly this — nothing more, nothing less**:

1. **Predict congestion hotspots** using vessel schedules and berth capacity data.
2. **Recommend alternate routing strategies.**
3. **Optimise berth and crane assignments.**
4. **Generate a 72-hour port operations plan** for shift supervisors.

Explicitly out of scope (per the master guide's no-scope-creep rule) unless all four items above work end-to-end: customs clearance, pricing/rating, carbon tracking, yard-level (inside-terminal) planning, and full AIS berth-clustering research.

## 4. What "solved" means for this submission

- Item 1 is a **real trained model** (not a lookup table) whose predictions are validated on a holdout and reported with error bands.
- Item 3 is a **real assignment optimiser** constrained by the *published, real* POLB terminal capacities, compared against an industry-default FIFO baseline.
- Item 4 is **structured output** (JSON + human-readable shift text) a supervisor could actually print for handover.
- All four are reachable **from the dashboard** and **through Bob**, the AI ops assistant that invokes the engines and answers strictly from their output.

PortFlow SBX implements all four items end-to-end; the mapping of each item to code, API and UI lives in the root `README.md` and `docs/architecture.md`.
