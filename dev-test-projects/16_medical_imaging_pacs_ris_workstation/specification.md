# 16 - Medical Imaging PACS/RIS Workstation Foundation

Complexity tier: 16/20
Expected decomposition size: 42-46 dependent implementation cards before coding.
Domain pressure: DICOM-like imaging, radiology workflow, hanging protocols, measurements, reporting, dose tracking, access control.
Acceptance command: npm test

## How to use this challenge
This is a dev-test project specification for evaluating whether an autonomous coding agent can decompose a real domain, identify knowledge gaps, build a correct foundation, and verify it with deterministic tests. The goal is not to finish the entire product. The goal is to build a durable foundation that proves the agent understood the domain boundaries and can implement the highest-risk core behaviors without hiding behind placeholders.

The agent must read this entire specification before planning. It must create a dependency-linked plan, record domain knowledge debt, and choose a narrow release slice that still exercises the real hard parts. Prefer fewer production-quality vertical slices over many shallow labels.

## Product vision
Build the foundation for a radiology imaging workstation and workflow system. The aim is a domain-correct PACS/RIS-style core with study ingestion, worklists, viewer state, measurements, reports, and audit controls, not a fake image gallery.

## Foundation release scope
The first serious buildout must include:
- Patient, accession, order, study, series, instance, modality, worklist item, reading assignment, measurement, annotation, report, addendum, dose event, and audit access models.
- DICOM-inspired metadata parser for deterministic JSON fixtures covering patient/study/series/instance hierarchy, modality, orientation, spacing, acquisition time, and burned-in annotation flags.
- Worklist prioritization using modality, status, STAT flag, site, subspecialty, SLA, unread comparisons, and radiologist availability.
- Hanging protocol engine that selects layout, prior studies, series order, synchronization groups, and window presets based on modality/body part.
- Measurement model for length, angle, region, SUV-like placeholder, timepoint comparison, and units tied to pixel spacing.
- Report workflow with draft, preliminary, final, addendum, critical result notification, and discrepancy review.
- Dose and quality tracker for repeated studies, missing metadata, rejected images, and acquisition protocol deviations.
- Seed imaging day with CT, MR, X-ray, ultrasound, missing prior, wrong patient merge risk, and critical result escalation.

## Architecture requirements
- Separate imaging metadata, workflow state, viewer presentation state, measurement geometry, reporting, and access policy.
- Treat image binary loading as an adapter; foundation tests use metadata and small fixture matrices only.
- Use coordinate systems and units explicitly for measurements.
- Make report finalization immutable except through addenda.

## Domain knowledge debt to surface
The agent should not pretend to know every regulation, standard, or numerical model perfectly. It should implement a defensible deterministic subset, mark assumptions explicitly, and create extension points where real-world integrations or expert-reviewed rule packs would live. Required knowledge areas:
- Radiology data is hierarchical and metadata-heavy; flat file lists lose meaning.
- Viewer state must respect modality, orientation, priors, and measurement units.
- Clinical reports need lifecycle controls and critical result evidence.
- Patient merge and wrong-study risk must be surfaced conservatively.

## Decomposition pressure
This project should force decomposition across domain modeling, calculation or policy engines, workflow state, deterministic fixtures, auditability, and UI/view-model boundaries. The plan should include dependency links so shared primitives and invariants are built before dependent workflow features. Avoid starting with screens. Start with the domain model, invariants, and tests that would make later screens trustworthy.

The agent should maintain a visible knowledge-debt list covering unclear standards, units, legal or safety constraints, numerical assumptions, terminology, fixture limitations, and future expert-review checkpoints. Knowledge debt is not a failure; hiding it is.

## Acceptance criteria
- Study hierarchy tests preserve patient, accession, study, series, and instance relationships.
- Hanging protocol tests select correct layouts for CT, MR, X-ray, and ultrasound fixtures.
- Measurement tests use pixel spacing and coordinate transforms.
- Report lifecycle tests cover final, addendum, critical result, and discrepancy review.
- The project passes npm test without real DICOM binaries.

## Explicit non-goals
- Do not build a photo gallery with medical labels.
- Do not claim diagnostic certification.
- Do not ignore patient identity and access audit rules.

## Quality bar
- Use typed domain objects and pure core modules wherever practical.
- Keep deterministic fixtures in the repository and do not depend on live APIs for acceptance tests.
- Test edge cases before building broad UI coverage.
- Every risk score, recommendation, workflow transition, or generated report must be explainable from source facts.
- Stubs are acceptable only at external integration boundaries and must be named as adapters with deterministic fixture implementations.
- The foundation should be extensible into a real product if later teams add integrations, expert-reviewed rule packs, and production UI.

---

# Extended scope & deep-reasoning extensions (v2)

> Added 2026-06-26 via deep domain research. **The single hardest, most-defining property of this project is that radiology is a *hierarchical, identity-critical, geometry-bearing, lifecycle-governed* domain where the dangerous bugs are never in the pixels — they are in attaching the right study to the right patient, measuring in real millimeters not pixels, hanging the right priors next to the right current, and never letting a finalized report mutate.** This is a PACS/RIS *core*, and its correctness lives in the metadata model, the patient-coordinate geometry, the worklist/hanging-protocol selection logic, and the immutable report lifecycle — not in an image viewer. Build those four seams first; the viewer is projection over them.

## E0. The reframing (why a "fake image gallery" is the explicitly-forbidden wrong answer)

The base spec bans "a photo gallery with medical labels," and the reason is structural: radiology data is a strict **information hierarchy** (Patient → Study → Series → Instance) where a flat list *destroys meaning*, and where the highest-severity real-world failures are **wrong-patient / wrong-study** errors and **measurement errors from ignoring pixel spacing**. The disciplined core is four load-bearing engines — (1) the DICOM information model with identity reconciliation, (2) patient-coordinate measurement geometry, (3) worklist prioritization + hanging-protocol selection, (4) the immutable report lifecycle with critical-result closed-loop — each deterministically testable on **metadata + tiny fixture matrices**, with pixel-binary loading isolated behind an adapter the tests never call.

## E1. Research-grounded domain authenticity (fold these real models in)

**The DICOM information model is the spine.** Model the four Information Entities — **Patient, Study, Series, Instance** (Image and Instance are synonymous in DICOM) — as a strict hierarchy, where each entity aggregates **Modules** of **Attributes**, and a concrete object is a **SOP Instance** of a **SOP Class** defined by an **IOD** (Information Object Definition); the **SOP Common Module** is on everything ([DICOM IODs/Modules/IEs](https://dicomiseasy.blogspot.com/2011/12/chapter-4-dicom-objects-in-chapter-3.html); [DICOM Information Model overview](https://www.dicomstandard.org/news-dir/current/docs/sups/sup223.pdf)). The metadata parser must preserve and key off the canonical UIDs: `StudyInstanceUID`, `SeriesInstanceUID`, `SOPInstanceUID`, plus `Modality (0008,0060)`, `AccessionNumber (0008,0050)`, body part, and acquisition time. **The accession number is the linking key** that follows a study from order → modality worklist → image tags → completion → report; `AccessionNumber (0008,0050)` ↔ `RequestedProcedureID (0040,1001)` are 1:1 within a study ([accession number as workflow key, IHE SWF](https://blog.medicai.io/en/ris-pacs-integration/)).

**Measurement geometry is patient-coordinate math, and getting it wrong is a clinical error.** The **Image Plane Module** gives the mapping from pixel indices to real-world millimeters via three attributes ([DICOM Image Plane Module C.7.6.2](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html); [getting oriented with the Image Plane Module](https://dicomiseasy.blogspot.com/2013/06/getting-oriented-using-image-plane.html)):
- **`PixelSpacing (0028,0030)`** — physical row/column spacing in **mm**.
- **`ImageOrientationPatient (0020,0037)`** — two unit vectors (row direction, column direction) in the patient **LPS** (Left-Posterior-Superior) coordinate system.
- **`ImagePositionPatient (0020,0032)`** — the 3D mm coordinate of the center of the top-left voxel.

Together they map `(i, j)` pixel → `(x, y, z)` mm in patient space: `P = IPP + i·(rowDir·colSpacing) + j·(colDir·rowSpacing)` ([pixel→patient transform](https://medium.com/redbrick-ai/dicom-coordinate-systems-3d-dicom-for-computer-vision-engineers-pt-1-61341d87485f); [DICOM coordinate conventions](https://www.micheledpierri.com/2025/10/12/dicom-orientation/)). A **length** is the Euclidean distance between two patient-space points (so anisotropic spacing is handled correctly); an **angle** is between two such vectors; **region/area** scales by `rowSpacing·colSpacing`. **Measurements that just count pixels are wrong** whenever spacing ≠ 1.0 or is anisotropic — this is the seam the spec's "use pixel spacing and coordinate transforms" criterion is testing. (Note the real-world subtlety: `PixelSpacing` is row-spacing\colSpacing order, and for projection radiography `ImagerPixelSpacing (0018,1164)` may differ from calibrated `PixelSpacing` — model the distinction as knowledge-debt.)

**Hanging protocols are a real DICOM IOD, not ad-hoc layout.** Model the **Hanging Protocol IOD** concepts ([DICOM Hanging Protocol Modules C.23](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.23.3.html); [Supplement 60: Hanging Protocols](https://www.dicomstandard.org/News-dir/ftsup/docs/sups/sup60.pdf)): an **Image Set Selector** (`00720022`) identifies which images by attribute match; **Time-Based Image Sets** (`0072,0030`) distinguish **current vs. prior** (the canonical example: mammography hangs *this year's* screening set beside *last year's* prior); **Display Sets** + **Image Boxes** define the layout grid; **Filter** and **Sorting Operations** (`0072,0600`) order images within a box; synchronization groups link scrolling/windowing across viewports. A hanging-protocol engine selects, for a given (modality, body part, study + available priors), the **layout, which priors, series order, sync groups, and window presets** — deterministically. The base spec's "select correct layouts for CT, MR, X-ray, and ultrasound" criterion maps directly onto choosing the right HP definition for each modality fixture.

**Worklist + workflow is IHE Scheduled Workflow (SWF).** Real radiology bridges HL7 (RIS/HIS) and DICOM (modality/PACS): the RIS populates the **Modality Worklist (MWL)** with patient ID, accession, scheduled procedure step, modality, timing; the modality fires **MPPS (Modality Performed Procedure Step)** to report what actually happened and close the step ([IHE Scheduled Workflow](https://wiki.ihe.net/index.php/Scheduled_Workflow); [MWL/MPPS](https://blog.medicai.io/en/dicom-modality-worklist/)). Orders/results flow as **HL7 v2 `ORM^O01`** (order) and **`ORU^R01`** (result), with `ADT` demographic events ([HL7 v2 in radiology](https://blog.medicai.io/en/hl7/)). Worklist prioritization keys off modality, status, **STAT flag**, site, subspecialty, **SLA/TAT**, unread-comparison availability, and radiologist availability — these are the base spec's prioritization inputs, grounded.

**Patient identity reconciliation is the highest-severity safety seam.** The DICOM/IHE answer to wrong-patient/wrong-study is the **Patient Information Reconciliation (PIR)** and **Import Reconciliation Workflow (IRWF)** profiles: studies acquired under a temporary/unknown identity (trauma "John Doe") or imported from outside must be reconciled to the correct patient, using **HL7 ADT** feeds and **IHE PIX (Patient Identifier Cross-referencing)** / **PDQ (Patient Demographics Query)** ([IHE Patient Information Reconciliation](https://wiki.ihe.net/index.php/Patient_Information_Reconciliation); [IHE PIX/PDQ for reconciliation](http://www.ihe.net/uploadedFiles/Documents/Radiology/IHE_RAD_TF_Rev16.0_Vol1_FT_2017_08_04.pdf); [outside-exam import reconciliation, PMC7165222](https://pmc.ncbi.nlm.nih.gov/articles/PMC7165222/)). The classic failure: a name spelled differently on the ADT vs. the order, an `A08` demographic update that the RIS applies but a PACS without a bidirectional ADT feed does **not**, leaving a mismatched study. **Merges must be conservative, reversible, and audited** — the spec's "wrong patient merge risk" fixture is exactly this.

**Reports have a governed lifecycle and a closed-loop for critical results.** Model `draft → preliminary → final → addendum`, where **finalization is immutable** (corrections only via addendum), plus **discrepancy review** (resident/AI preliminary vs. attending final) and **critical-result notification**. Real practice follows the **ACR Practice Parameter for Communication of Diagnostic Imaging Findings**, which defines three non-routine categories — **critical, discrepant, incidental** — with tiered communication timelines, and **closed-loop** acknowledgment that the ordering clinician received the critical finding ([ACR actionable/critical findings, JACR scoping review](https://www.jacr.org/article/S1546-1440(24)00773-7/fulltext); [closed-loop critical-results communication](https://erad.com/solutions/radar-radiology-critical-results-list/)). Discrepancy/peer-review uses the ACR **RADPEER** 4-point concordance scale (agreement → clinically-significant discrepancy) ([RADPEER scoring](https://ajronline.org/doi/10.2214/AJR.12.8972)). So critical-result notification is a **state machine with escalation on the clock**: notified → acknowledged, or escalate if not acknowledged within the tier's deadline.

**Dose & quality tracking is real metric capture.** For CT, capture the **Radiation Dose Structured Report (RDSR)**-style metrics: **CTDIvol** (mGy, referenced to 16/32-cm phantom), **DLP** (mGy·cm = CTDIvol × scan length), and **SSDE** (size-specific dose estimate, scaling CTDIvol by patient diameter), compared to **Diagnostic Reference Levels (DRLs)** ([CTDIvol/DLP/SSDE definitions](https://pmc.ncbi.nlm.nih.gov/articles/PMC10141413/); [DRLs from CTDIvol/DLP](https://www.sciencedirect.com/science/article/abs/pii/S0969806X25003056)). The quality tracker also flags **repeated studies, missing metadata, rejected images, burned-in PHI annotations, and acquisition-protocol deviations** — the base spec's dose/quality criteria, grounded.

**De-identification, when exporting, is Safe-Harbor-shaped.** A research/teaching export adapter must strip the **18 HIPAA identifiers** (names, all geographic subdivisions < state, all date elements except year, ages > 89 → "90+", device/serial numbers) from DICOM headers **and** must consider **burned-in pixel annotations** (`BurnedInAnnotation (0028,0301)`) ([HIPAA Safe Harbor 18 identifiers](https://www.hipaajournal.com/de-identification-protected-health-information/); [DICOM de-identification incl. burned-in PHI](https://dcmsys.com/project/de-identification-in-medical-imaging/)). This is a fixture-only adapter; tests assert PHI removal, not real export.

## E2. The hardest technical seams (where this stops being CRUD)

1. **The hierarchical metadata model with UID integrity (the foundation).** A typed Patient→Study→Series→Instance graph keyed by `StudyInstanceUID`/`SeriesInstanceUID`/`SOPInstanceUID`, with the accession number as the workflow key. **Referential integrity is an invariant:** no orphan series, no instance without a series, no study under two patients without an explicit reconciliation event. The DICOM-inspired parser ingests fixture JSON (patient/study/series/instance + modality/orientation/spacing/acquisition-time/burned-in flag) and **rejects** structurally invalid trees rather than silently flattening them.
2. **Patient-coordinate measurement geometry (a correctness minefield).** A geometry module with explicit LPS coordinate types: `pixelToPatient(i, j, IPP, IOP, PixelSpacing) → (x,y,z)mm`, length/angle/area in millimeters, and **timepoint comparison** (a lesion measured on study A vs. the prior study B must compare in *patient mm*, surfacing spacing differences). Measurements **carry their coordinate basis and units**; a measurement made on an image with unknown/absent spacing is a *flagged, non-comparable* state, not a silent pixel count. SUV-like values are a typed placeholder (real SUV needs injected dose/weight/time — model the inputs, mark the math as debt).
3. **Hanging-protocol selection as deterministic policy.** `selectHangingProtocol(study, availablePriors, modality, bodyPart) → {layout, displaySets[], priorSelection, seriesOrder, syncGroups, windowPresets}`. Prior selection (which prior, how many, "most recent same-modality same-body-part") and current/prior pairing are the hard parts; the engine is a pure function over metadata so CT/MR/XR/US fixtures each select the expected layout. **Missing-prior is a first-class outcome** (hang current-only + surface "no comparable prior"), not a crash.
4. **Identity reconciliation + conservative merge (the safety seam).** A `reconcile`/`merge` engine that: detects identity mismatch (demographic divergence across ADT/order/image), proposes a merge **only** with sufficient matching evidence, makes the merge **reversible** and **audited**, and **quarantines** ambiguous cases for human decision rather than auto-merging. Wrong-patient risk must be surfaced *conservatively* — over-merging two real patients is catastrophic, so the default on ambiguity is *block + flag*, never *guess*.
5. **Immutable report lifecycle + critical-result closed-loop.** `draft → preliminary → final → addendum`, finalization frozen (corrections = addendum referencing the final), discrepancy review (preliminary vs. final concordance, RADPEER-style), and a **critical-result notification state machine** that escalates on the virtual clock if acknowledgment isn't received within the criticality tier's deadline. "Reconstruct what the final report said at finalization time T" must be exact.
6. **Worklist prioritization as explainable ranking.** A pure `prioritize(worklistItems, context) → ranked[]` over modality/status/STAT/site/subspecialty/SLA/unread-comparison/availability, where every item's rank is **explainable from its inputs** (no opaque score). STAT and SLA-breach must dominate deterministically.

## E3. Determinism & testability strategy

- **Image binary is an adapter the tests never call.** All foundation tests run on **metadata + tiny fixture pixel matrices** (e.g. a 4×4 with known spacing) — never real DICOM binaries (an explicit acceptance criterion). The `PixelDataLoader` is a named adapter with a deterministic fixture implementation; production wires it to WADO-RS/file storage.
- **DICOMweb is the production retrieval shape, fixtures in test.** Model the interfaces after **QIDO-RS** (query studies/series/instances → DICOM-JSON), **WADO-RS** (retrieve), **STOW-RS** (store), and **UPS-RS** (worklist) so the foundation can later speak DICOMweb, but `npm test` hits in-repo fixtures, never the network ([DICOMweb QIDO/WADO/STOW](https://en.wikipedia.org/wiki/DICOMweb); [DICOMweb RESTful structure](https://www.dicomstandard.org/using/dicomweb/restful-structure)). HL7 v2 `ORM`/`ORU`/`ADT` and DICOM MWL/MPPS are likewise fixture adapters.
- **Virtual clock everywhere.** Acquisition times, SLA/TAT countdowns, critical-result escalation deadlines, "study age" for prior selection, and dose-tracking windows all read an injected `Clock`. Critical-result escalation and SLA breaches are deterministic for a fixed clock.
- **Append-only audit + event-sourced workflow state.** Every access, identity merge/unmerge, report state transition, addendum, and critical-result notification/acknowledgment is an append-only event with actor/time/context; worklists, viewer state, and report status are **projections**. Merges and report finalization are events you can replay and audit — never destructive edits.
- **Geometry is pure + property-tested** (no I/O), so the pixel→patient transform and length/angle/area are exhaustively checkable, including anisotropic and rotated-orientation cases.
- **The flagship test:** seed the imaging day (CT, MR, X-ray, ultrasound, a missing prior, a wrong-patient-merge-risk, a critical result), and assert (1) the study hierarchy preserves all UID relationships, (2) hanging protocols select the expected layouts incl. missing-prior handling, (3) measurements match the closed-form patient-mm answer on anisotropic fixtures, (4) the report lifecycle is immutable past final and critical-results escalate on the clock, (5) the ambiguous merge is quarantined not auto-applied, (6) zero network / no real binaries.

## E4. Adversarial, failure, and edge-case scenarios (ship these as fixtures)

- **The anisotropic measurement trap:** a series with `PixelSpacing = [0.5, 1.2]` (row≠col) and a non-axial `ImageOrientationPatient`; a length drawn across it must equal the **patient-mm** Euclidean distance, not the pixel count × a single spacing value. The pixel-counting implementation must fail this test.
- **The wrong-patient merge risk:** two studies with near-identical demographics but a one-character name/DOB divergence (the classic ADT-vs-ORM mismatch). The engine must **not** auto-merge; it quarantines and flags, and any merge it does perform is reversible + audited. A trauma "John Doe / Unknown" study must reconcile to the real patient only on an explicit reconciliation event ([PIR/IRWF](https://wiki.ihe.net/index.php/Patient_Information_Reconciliation)).
- **The missing prior:** a follow-up CT whose hanging protocol wants a comparison prior, but none exists; the engine hangs current-only and surfaces "no comparable prior," never errors or silently fabricates a layout.
- **The finalized-report mutation attempt:** code tries to edit a `final` report in place; the system must reject it and require an **addendum** that references the final, preserving the original exactly.
- **The unacknowledged critical result:** a STAT critical finding is notified but not acknowledged within the tier deadline (on the clock) → escalation fires deterministically; an acknowledged one does not escalate ([ACR closed-loop](https://www.jacr.org/article/S1546-1440(24)00773-7/fulltext)).
- **The burned-in-PHI export:** a study flagged `BurnedInAnnotation = YES` routed to the de-identification export adapter must be withheld/flagged for pixel-redaction, not exported with header-only de-id ([burned-in PHI](https://dcmsys.com/project/de-identification-in-medical-imaging/)).
- **The STAT-jumps-the-queue worklist:** a STAT ED study must outrank an older routine outpatient study deterministically; an SLA-breaching routine study escalates in rank on the clock.
- **The orphan instance:** a fixture with an instance whose `SeriesInstanceUID` references no series must be **rejected** by the parser (referential-integrity invariant), not flattened into the gallery.
- **The cross-modality body-part mismatch:** a hanging protocol for "CT chest" must not select an "MR brain" prior as a comparison.

## E5. Rigorous acceptance criteria, including invariants (property-based)

Add to the existing criteria as property tests over randomized + scripted study fixtures:
1. **Hierarchy referential integrity:** for any ingested dataset, every instance has exactly one parent series, every series exactly one parent study, every study exactly one patient (or an explicit reconciliation event) — no orphans, no multi-parent without a merge event. Fuzz malformed trees → all rejected.
2. **Geometry correctness:** `pixelToPatient`/length/angle/area match the closed-form LPS answer for random spacings (incl. anisotropic) and random orthonormal orientations; a length is invariant under valid rigid re-expression of the same plane. Measurements on spacing-absent images are flagged non-comparable, never silently computed.
3. **Report immutability + reconstructability:** no `final` report is ever mutated; for any report with K addenda, the finalized content is exactly reconstructable and each addendum's delta/author/time/reason is intact.
4. **Merge reversibility + audit totality:** every identity merge is reversible and has exactly one audit event with actor/evidence; no auto-merge occurs below the evidence threshold; un-merge restores prior state exactly.
5. **Critical-result closed-loop:** an unacknowledged critical result escalates **iff** its tier deadline passes on the clock; an acknowledged one never escalates; every notification/acknowledgment/escalation is audited.
6. **Worklist ranking explainability + determinism:** ranking is a total order, deterministic for fixed inputs, and every item's position is reconstructable from its attributes; STAT/SLA-breach dominate.
7. **Hanging-protocol totality:** for every (modality, body-part) fixture the engine returns a valid layout; missing-prior yields current-only + a surfaced flag; no crash, no fabricated prior.
8. **Audit/access totality:** every study access and every workflow transition emits exactly one audit event referencing the patient; redact prose — the structured record alone answers "who accessed this study, what was merged, and when did this report finalize?"

## E6. The concrete first vertical slice (the on-ramp — build THIS first, ~42–46 cards)

Prove the four spine seams end-to-end before any viewer breadth:
1. **Typed hierarchical domain model** (patient, accession, order, study, series, instance, modality, worklist-item, reading-assignment, measurement, annotation, report, addendum, dose-event, audit-access) with **UID referential-integrity invariants** + append-only audit log.
2. **DICOM-inspired metadata parser** over fixture JSON (patient/study/series/instance hierarchy, modality, orientation, spacing, acquisition time, burned-in flag) that **rejects malformed trees**.
3. **Patient-coordinate geometry module** — `pixelToPatient`, length/angle/area in mm, timepoint comparison, units-and-basis carried, spacing-absent → flagged; property-tested on anisotropic/rotated fixtures.
4. **Worklist prioritization** — explainable, deterministic ranking over modality/status/STAT/site/subspecialty/SLA/unread/availability, on the clock.
5. **Hanging-protocol engine** — `selectHangingProtocol` returning layout/displaySets/prior-selection/series-order/sync-groups/window-presets; missing-prior as a first-class outcome; CT/MR/XR/US fixtures select expected layouts.
6. **Identity reconciliation + conservative reversible merge** — mismatch detection, evidence-thresholded merge, quarantine-on-ambiguity, full audit, un-merge.
7. **Report lifecycle** — draft/preliminary/final/addendum (final immutable), discrepancy review (RADPEER-style concordance), and the **critical-result notification state machine** with clock-driven escalation.
8. **Dose & quality tracker** — capture CTDIvol/DLP/SSDE vs. DRL placeholder, flag repeats/missing-metadata/rejected-images/burned-in-PHI/protocol-deviations.
9. **De-identification export adapter** (fixture-only) — strips the 18 HIPAA identifiers from headers, withholds/flags burned-in-PHI studies.
10. The **adversarial fixtures (E4)** and **invariants (E5)** all green; `npm test` with **no real DICOM binaries** and zero network.

If that slice holds, the viewer and remaining panels are presentation over a geometry-correct, identity-safe, lifecycle-governed core.

## E7. Domain knowledge-debt to track (surface, don't bluff)

Maintain a live, *action-gating* knowledge-debt ledger (owner / risk / forcing-trigger / expert-review flag):
- **No diagnostic certification.** This is a workflow/metadata foundation, not a diagnostic device; any "diagnostic-quality" or "FDA-cleared" claim is blocked pending regulatory review. The viewer is *not* a validated diagnostic display (real ones need calibrated luminance per ACR/AAPM/DICOM GSDF).
- **`PixelSpacing` vs. `ImagerPixelSpacing` vs. calibrated spacing** differ for projection radiography and some modalities; magnification, detector geometry, and calibration objects matter — the geometry module's spacing source is a starting assumption needing medical-physics review ([Image Plane Module nuances](https://dicom.nema.org/medical/dicom/current/output/chtml/part03/sect_C.7.6.2.html)).
- **SUV and dose math are placeholders.** Real SUV needs injected activity/decay/patient weight + time; real CTDIvol→effective-dose conversion needs k-factors and SSDE needs water-equivalent diameter — model the inputs, mark the formulas as expert-review debt ([SSDE/DRL methodology](https://www.sciencedirect.com/science/article/abs/pii/S0969806X25003056)).
- **Patient merge is medico-legally dangerous.** Merge/un-merge policy, evidence thresholds, and who may authorize are org-policy + safety decisions; the conservative-by-default behavior is a starting model needing clinical-informatics sign-off ([IHE PIR/IRWF](https://wiki.ihe.net/index.php/Patient_Information_Reconciliation)).
- **Critical-result tiers and timelines** follow ACR practice-parameter *concepts* but specific deadlines/escalation paths are institutional policy ([ACR communication parameter](https://www.jacr.org/article/S1546-1440(24)00773-7/fulltext)).
- **De-identification is hard to get fully right** (private tags, burned-in pixels, dates that are clinically needed, longitudinal re-identification) — Safe Harbor header-stripping is necessary-not-sufficient and needs an expert-determination pass for any real release ([HIPAA de-id 2026 update](https://www.hipaajournal.com/de-identification-protected-health-information/)).
- **Real DICOM/IHE conformance** (SOP class negotiation, transfer syntaxes, MWL/MPPS/Storage Commitment, DICOMweb auth) is out of scope for the foundation; the fixture adapters mark the production-integration boundary.

## E8. Why this is a great !Klein challenge

It is the most *structurally unforgiving* of the healthcare set: the domain itself punishes hand-waving. A small/quantized model cannot bluff a hierarchy invariant (orphans get rejected), cannot bluff geometry (the anisotropic fixture has one right millimeter answer), cannot bluff a hanging-protocol selection (each modality fixture expects a specific layout), and cannot bluff report immutability (the mutation attempt must be refused). It stresses **deep dependency-ordered decomposition** (geometry and the metadata model must exist before measurements, which must exist before reports), **deterministic numeric correctness under weak models** (patient-coordinate math is exactly where a fallible model needs a property test to keep it honest), **conservative safety defaults** (the merge engine must prefer *block + flag* over a confident wrong guess — the small-model north star), and **immutable, total audit** across a multi-actor radiology workflow. The win condition is a PACS/RIS *core* where every measurement is real-mm, every study is provably on the right patient, every prior hangs by rule, and no finalized report can change — which is precisely the discipline that separates "a medical-imaging app a small model wrote" from "a foundation a radiologist could trust." Build the metadata model + geometry + hanging-protocol + immutable-report seams first; the viewer is projection.
