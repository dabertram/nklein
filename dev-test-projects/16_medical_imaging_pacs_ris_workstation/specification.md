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

---

## Small-model build guide (3B-ready)

> This section is a mechanical build guide for a ~3B-parameter model running via !Klein. Every card is small enough to implement and verify in isolation. Follow the cards in order; never skip a dependency. The parent section (E6) listed 10 high-level steps; this guide expands the first vertical slice into 18 small cards (R01–R18) and gives repeatable recipes for the remaining breadth.

---

### 1. Glossary & ground rules

**Domain terms**

| Term | Meaning in this project |
|---|---|
| Patient entity | Top of the DICOM information hierarchy. Identified by `PatientID (0010,0020)`. |
| Study entity | A set of images acquired in one session. Identified by `StudyInstanceUID`. Links to one Patient. |
| Series entity | A set of images in one acquisition sequence within a Study. Identified by `SeriesInstanceUID`. Has a `Modality`. |
| Instance entity | One image/object (a SOP Instance). Identified by `SOPInstanceUID`. Belongs to one Series. |
| AccessionNumber | The workflow linking key (`0008,0050`). Ties the order → worklist entry → image tags → report. |
| Modality | Acquisition type: `CT`, `MR`, `XR` (X-ray), `US` (ultrasound), `PT` (PET), `NM`, etc. |
| IPP | `ImagePositionPatient (0020,0032)`: 3D mm coordinates of the top-left voxel in patient (LPS) space. |
| IOP | `ImageOrientationPatient (0020,0037)`: two unit vectors (row direction, column direction) in LPS space. |
| PixelSpacing | `(0028,0030)`: physical row/column spacing in mm. Two values; may be anisotropic (row ≠ col). |
| LPS | Left-Posterior-Superior: the standard DICOM patient coordinate system. +X = Left, +Y = Posterior, +Z = Superior. |
| SOP Class | Defines the type of DICOM object (e.g. CT Image, MR Image, Structured Report). |
| SOPInstanceUID | Globally unique identifier for one image instance. |
| Hanging Protocol | A rule that selects which images to display, in what layout, with which priors. |
| Prior | A previous study used for comparison. Selected by same modality + same body part, most recent. |
| STAT flag | Priority marker for urgent studies. Must dominate the worklist ranking. |
| TAT / SLA | Turnaround time / service-level agreement for worklist completion. |
| CTDIvol | Volume CT Dose Index (mGy): dose metric per CT acquisition, referenced to a 16/32-cm phantom. |
| DLP | Dose-Length Product (mGy·cm) = CTDIvol × scan length. |
| SSDE | Size-Specific Dose Estimate: CTDIvol scaled by patient size proxy. |
| DRL | Diagnostic Reference Level: the population-median reference for CTDIvol/DLP. |
| RADPEER | ACR peer-review concordance scale: 1 (agree) → 4 (major clinically-significant discrepancy). |
| AuditEvent | Append-only record of every study access and workflow transition. Never mutated or deleted. |
| Clock | An injected interface `{ now(): Date }`. All time-dependent logic reads this, never `Date.now()`. |
| BurnedInAnnotation | DICOM tag `(0028,0301)`: `'YES'` means PHI text is baked into pixel data — cannot de-identify with header-only stripping. |

**Stack**

- Language: TypeScript (strict mode, no `any`).
- Runtime: Node.js.
- Test runner: Vitest (or Jest; whatever `npm test` is wired to).
- No real DICOM binaries in tests. All tests use metadata + tiny numeric fixture matrices.
- All fixtures live under `src/fixtures/` as plain TypeScript objects.
- Pixel data loading: `PixelDataLoader` adapter in `src/adapters/pixel-data-loader.ts`. Tests never call it.

**Acceptance command (run after every card)**

```
npm test
```

Must exit 0. Zero network calls. No real DICOM binaries. Deterministic on any machine.

**Determinism rules (imperative)**

1. Never call `Date.now()`, `new Date()` (no argument), or `Math.random()` in production modules.
2. All time reads go through the injected `Clock` interface defined in `src/core/clock.ts`.
3. All geometry functions are pure: same inputs → same outputs. No floating-point non-determinism issues exist here because tests use exact rational inputs (spacings like `0.5`, `1.2`) with exact expected outputs computed by hand.
4. For floating-point comparisons use `expect(result).toBeCloseTo(expected, 6)` (6 decimal places).
5. Audit events are appended to an in-memory array; never update or delete an entry.
6. Sort collections before asserting contents.

---

### 2. The explicit task graph for the first vertical slice

The first slice covers E6 steps 1–10. Cards R01–R18 below implement them in strict dependency order.

---

**R01 — Core type definitions**
dependsOn: none
files: `src/core/types.ts`

interface (write these exact exports):
```ts
export type PatientId = string & { readonly __brand: 'PatientId' };
export type StudyInstanceUID = string & { readonly __brand: 'StudyInstanceUID' };
export type SeriesInstanceUID = string & { readonly __brand: 'SeriesInstanceUID' };
export type SOPInstanceUID = string & { readonly __brand: 'SOPInstanceUID' };
export type AccessionNumber = string & { readonly __brand: 'AccessionNumber' };
export type Modality = 'CT' | 'MR' | 'XR' | 'US' | 'PT' | 'NM' | 'SR';
export type ReportStatus = 'draft' | 'preliminary' | 'final' | 'amended';
export type WorklistStatus = 'scheduled' | 'in-progress' | 'completed' | 'cancelled';
export type IdentityMergeStatus = 'pending' | 'confirmed' | 'rejected' | 'quarantined';
export type CriticalResultTier = 'critical' | 'urgent' | 'routine';
export type CriticalResultStatus = 'notified' | 'acknowledged' | 'escalated';
export type RadpeerScore = 1 | 2 | 3 | 4;

// LPS coordinate type — always 3D patient-space millimeters
export type LpsPoint = { x: number; y: number; z: number };

// Pixel index pair (row index i, column index j) — always integers
export type PixelIndex = { i: number; j: number };

// Image plane attributes (from DICOM Image Plane Module)
export type ImagePlane = {
  ipp: LpsPoint;             // ImagePositionPatient: top-left voxel center in mm
  iop: { rowDir: LpsPoint; colDir: LpsPoint };  // ImageOrientationPatient: two unit vectors
  pixelSpacing: { rowMm: number; colMm: number }; // row and column spacing in mm
};
```

how to implement:
1. Create `src/core/types.ts`.
2. Copy the exact definitions above. All UIDs are branded strings.
3. Export everything at file level, no default exports.

acceptance: `test/types.test.ts` — compile-only; import and assign a literal to each typed variable. `npm test` → green.

---

**R02 — Injected Clock + FixedClock**
dependsOn: R01
files: `src/core/clock.ts`, `src/core/fixed-clock.ts`, `test/fixed-clock.test.ts`

interface:
```ts
export interface Clock { now(): Date; }
export class FixedClock implements Clock {
  constructor(private readonly fixedTime: Date) {}
  now(): Date { return new Date(this.fixedTime.getTime()); }
}
```

acceptance: `new FixedClock(new Date('2025-01-15T08:00:00Z')).now().toISOString() === '2025-01-15T08:00:00.000Z'`. Two calls return equal values, distinct objects. `npm test` → green.

---

**R03 — Append-only AuditLog**
dependsOn: R01, R02
files: `src/core/audit-log.ts`, `test/audit-log.test.ts`

interface:
```ts
export type AuditActionType = 'study-access' | 'worklist-update' | 'identity-merge' | 'identity-unmerge' |
  'report-transition' | 'critical-result-notification' | 'critical-result-acknowledged' |
  'critical-result-escalated' | 'dose-event';
export type AuditEventRecord = {
  id: string;
  actionType: AuditActionType;
  occurredAt: Date;
  patientId: PatientId;
  actorId: string;
  studyInstanceUID?: StudyInstanceUID;
  details: Record<string, string>;
};

export class AuditLog {
  append(event: Omit<AuditEventRecord, 'id'>): AuditEventRecord;
  getAll(): readonly AuditEventRecord[];
  getByPatient(patientId: PatientId): readonly AuditEventRecord[];
}
```

how to implement:
1. Create `src/core/audit-log.ts`. Sequential counter IDs. Never mutate/delete.
2. Create `test/audit-log.test.ts`.

acceptance:
- Appending two events → IDs `'1'`, `'2'`.
- `getByPatient` filters correctly.
- Returned array is a copy (mutating it does not alter the store).
Run `npm test` → green.

---

**R04 — DICOM hierarchy domain model**
dependsOn: R01, R03
files: `src/core/dicom-model.ts`, `test/dicom-model.test.ts`

interface:
```ts
export type DicomPatient = { patientId: PatientId; name: string; birthDate: string; sex?: 'M' | 'F' | 'O' };
export type DicomStudy = {
  studyInstanceUID: StudyInstanceUID;
  patientId: PatientId;
  accessionNumber: AccessionNumber;
  studyDate: string;   // YYYYMMDD
  studyDescription: string;
  modalities: Modality[];   // all modalities present in this study
};
export type DicomSeries = {
  seriesInstanceUID: SeriesInstanceUID;
  studyInstanceUID: StudyInstanceUID;
  modality: Modality;
  seriesNumber: number;
  bodyPart: string;
  seriesDescription: string;
};
export type DicomInstance = {
  sopInstanceUID: SOPInstanceUID;
  seriesInstanceUID: SeriesInstanceUID;
  instanceNumber: number;
  imagePlane?: ImagePlane;    // absent for non-image SOP classes (e.g. SR)
  burnedInAnnotation: boolean;
};
```

how to implement:
1. Create `src/core/dicom-model.ts` with the four types above.
2. No logic in this file — just types. The parser (R05) enforces referential integrity.
3. Create `test/dicom-model.test.ts` — compile-only: instantiate one of each type, assign to typed variables.

acceptance: Compiles with no errors. `npm test` → green.

---

**R05 — DICOM metadata parser (fixture JSON → validated hierarchy)**
dependsOn: R01, R03, R04
files: `src/core/dicom-parser.ts`, `src/fixtures/dicom-fixtures.ts`, `test/dicom-parser.test.ts`

interface:
```ts
// The fixture JSON shape — mirrors what the adapter would produce from real DICOM headers
export type DicomFixtureTree = {
  patient: DicomPatient;
  studies: {
    study: DicomStudy;
    series: {
      series: DicomSeries;
      instances: DicomInstance[];
    }[];
  }[];
};

export type ParseResult =
  | { valid: true; patient: DicomPatient; studies: DicomStudy[]; series: DicomSeries[]; instances: DicomInstance[] }
  | { valid: false; errors: string[] };

// Parse and validate. Rejects:
// - any instance whose seriesInstanceUID has no corresponding DicomSeries
// - any series whose studyInstanceUID has no corresponding DicomStudy
// - any study whose patientId has no corresponding DicomPatient
export function parseDicomTree(tree: DicomFixtureTree): ParseResult;
```

how to implement:
1. Create `src/core/dicom-parser.ts`.
2. Flatten the nested structure into arrays. Then do three referential-integrity checks:
   - Every `DicomInstance.seriesInstanceUID` must appear in the series array.
   - Every `DicomSeries.studyInstanceUID` must appear in the studies array.
   - Every `DicomStudy.patientId` must match the fixture patient.
3. If any check fails, return `{ valid: false, errors: [...] }` listing the offending UIDs.
4. Create `src/fixtures/dicom-fixtures.ts` with at least:
   - A valid tree: 1 patient, 2 studies (one CT with 2 series of 3 instances each; one MR with 1 series), with `imagePlane` set on CT instances (anisotropic `pixelSpacing: { rowMm: 0.5, colMm: 1.2 }`).
   - A malformed tree: one instance with a `seriesInstanceUID` that has no matching series.
5. Create `test/dicom-parser.test.ts`.

acceptance:
- Valid fixture → `{ valid: true }` with correct counts (6 CT instances + 1 MR series etc.).
- Malformed fixture (orphan instance) → `{ valid: false, errors: [... mentions the orphan UID ...] }`.
- `parseDicomTree` does not throw on malformed input; it returns the error result.
Run `npm test` → green.

---

**R06 — Patient-coordinate geometry module**
dependsOn: R01
files: `src/core/geometry.ts`, `test/geometry.test.ts`

interface:
```ts
// Convert pixel index (i, j) to LPS patient-space coordinates in mm.
// Formula: P = IPP + i * (rowDir * colSpacing) + j * (colDir * rowSpacing)
// NOTE: DICOM PixelSpacing[0] = rowSpacing (physical distance between rows = column pitch),
//       PixelSpacing[1] = colSpacing (physical distance between columns = row pitch).
export function pixelToPatient(pixel: PixelIndex, plane: ImagePlane): LpsPoint;

// Euclidean distance between two LPS points in mm.
export function lengthMm(a: LpsPoint, b: LpsPoint): number;

// Angle in degrees between two vectors (a→b) and (a→c) in patient space.
export function angleDeg(a: LpsPoint, b: LpsPoint, c: LpsPoint): number;

// Area of a rectangle defined by two corner points (A and B diagonally opposite),
// given the image plane (row and column directions define the rectangle sides).
// Result in mm². Assumes the rectangle sides are aligned with row/col directions.
export function rectAreaMm2(a: LpsPoint, b: LpsPoint, plane: ImagePlane): number;

// Marker for a measurement made without valid pixel spacing — cannot be compared.
export type FlaggedMeasurement = { value: null; reason: 'spacing-absent' };
export type Measurement = { value: number; unit: 'mm' | 'mm2' | 'deg' } | FlaggedMeasurement;

// Compute length, returning FlaggedMeasurement if plane is missing or spacing is zero.
export function measureLength(a: PixelIndex, b: PixelIndex, plane: ImagePlane | undefined): Measurement;
```

how to implement:
1. Create `src/core/geometry.ts`.
2. `pixelToPatient`:
   ```
   P.x = ipp.x + i * (iop.rowDir.x * plane.pixelSpacing.colMm) + j * (iop.colDir.x * plane.pixelSpacing.rowMm)
   P.y = ipp.y + i * (iop.rowDir.y * plane.pixelSpacing.colMm) + j * (iop.colDir.y * plane.pixelSpacing.rowMm)
   P.z = ipp.z + i * (iop.rowDir.z * plane.pixelSpacing.colMm) + j * (iop.colDir.z * plane.pixelSpacing.rowMm)
   ```
   Note: `i` advances along rows (so multiplied by `colMm` — the spacing between rows = column pitch); `j` advances along columns (so multiplied by `rowMm` — the spacing between columns = row pitch). This follows DICOM convention.
3. `lengthMm`: `Math.sqrt((b.x-a.x)**2 + (b.y-a.y)**2 + (b.z-a.z)**2)`.
4. `angleDeg`: compute vectors `u = b - a` and `v = c - a`, use `Math.acos(dot(u,v)/(|u|*|v|)) * 180/Math.PI`.
5. `rectAreaMm2`: `Math.abs(lengthMm(a, {x:a.x+(b.x-a.x),y:a.y,z:a.z}) * lengthMm(a, {x:a.x,y:a.y+(b.y-a.y),z:a.z}))` — for an axis-aligned rectangle this simplifies; for a general rectangle use the cross-product magnitude. Simpler: `|a.x - b.x| * |a.y - b.y|` only for a perfectly axis-aligned case; use the general approach `lengthMm(a, projectedB) * lengthMm(a, projectedC)` if needed. For this project the fixture keeps it simple: `Math.abs((b.x-a.x) * plane.pixelSpacing.rowMm * (b.y-a.y) * plane.pixelSpacing.colMm)` — override if you compute it differently as long as the acceptance test passes.
6. `measureLength`: if `!plane || plane.pixelSpacing.rowMm === 0 || plane.pixelSpacing.colMm === 0`, return `{ value: null, reason: 'spacing-absent' }`. Otherwise convert pixels to patient space and return `{ value: lengthMm(...), unit: 'mm' }`.
7. Create `test/geometry.test.ts`.

acceptance (compute expected values by hand for these fixtures):
- `pixelToPatient({ i: 0, j: 0 }, isotropicPlane)` returns the IPP exactly (when i=j=0, P = IPP).
- Isotropic plane (spacing 1.0mm, identity IOP): `pixelToPatient({ i: 3, j: 4 }, ...)`. With identity IOP (rowDir={1,0,0}, colDir={0,1,0}), IPP={0,0,0}: P = {i*colSpacing, j*rowSpacing, 0} = {3, 4, 0}.
- Anisotropic plane (rowMm=0.5, colMm=1.2, identity IOP, IPP={0,0,0}): `pixelToPatient({ i: 2, j: 3 }, ...)` = {2*1.2, 3*0.5, 0} = {2.4, 1.5, 0}. `lengthMm` of the two points: `Math.sqrt(2.4**2 + 1.5**2)` ≈ 2.833.
- `measureLength({i:0,j:0}, {i:2,j:3}, anisotropicPlane)` returns `{ value: ~2.833, unit: 'mm' }` (within 0.001).
- `measureLength({i:0,j:0}, {i:1,j:1}, undefined)` returns `{ value: null, reason: 'spacing-absent' }`.
- All geometric checks use `toBeCloseTo(expected, 4)` to handle floating-point.
Run `npm test` → green.

---

**R07 — Worklist item model + prioritization engine**
dependsOn: R01, R02, R04
files: `src/core/worklist.ts`, `src/fixtures/worklist-fixtures.ts`, `test/worklist.test.ts`

interface:
```ts
export type WorklistItem = {
  id: string;
  patientId: PatientId;
  accessionNumber: AccessionNumber;
  studyInstanceUID: StudyInstanceUID;
  modality: Modality;
  bodyPart: string;
  subspecialty: string;
  status: WorklistStatus;
  statFlag: boolean;         // STAT = highest priority
  slaDueAt: Date;            // SLA deadline for completion
  receivedAt: Date;
  unreadComparisonAvailable: boolean;
  radiologistAvailable: boolean;
  site: string;
};

// Rank worklist items deterministically.
// Priority rules (highest first):
//  1. statFlag === true  (STAT always first)
//  2. slaDueAt <= clock.now() (SLA breached — escalate routine to near-STAT)
//  3. Earlier receivedAt (older studies first within the same tier)
// Returns a new sorted array; does not mutate the input.
export function prioritizeWorklist(items: WorklistItem[], clock: Clock): WorklistItem[];
```

how to implement:
1. Create `src/core/worklist.ts`.
2. `prioritizeWorklist`: sort by (STAT first, then SLA-breached first, then oldest receivedAt first). Use a stable sort. Never mutate the input array.
3. Create `src/fixtures/worklist-fixtures.ts` with 4+ items: one STAT CT, one routine MR (SLA breached), one routine US (SLA not breached), one routine XR (SLA not breached, newer than US).
4. Create `test/worklist.test.ts`.

acceptance:
- The STAT CT item is always first regardless of receivedAt.
- Among non-STAT items, the SLA-breached MR comes before the non-breached items.
- Among non-STAT, non-breached items, the older (earlier receivedAt) US comes before the newer XR.
- Calling `prioritizeWorklist` twice with the same inputs returns arrays with the same order (deterministic).
Run `npm test` → green.

---

**R08 — Hanging protocol engine**
dependsOn: R01, R04, R07
files: `src/core/hanging-protocol.ts`, `src/fixtures/hanging-protocol-fixtures.ts`, `test/hanging-protocol.test.ts`

interface:
```ts
export type HangingProtocolDef = {
  id: string;
  modality: Modality;
  bodyPart: string;        // '*' means any body part
  layout: { rows: number; cols: number };
  displaySets: { label: string; seriesFilter: (s: DicomSeries) => boolean }[];
  priorSelectionStrategy: 'most-recent-same-modality-same-body-part' | 'none';
  syncGroups: { type: 'scroll' | 'window' | 'zoom'; displaySetLabels: string[] }[];
  windowPreset?: { center: number; width: number };
};

export type HangingProtocolResult =
  | { matched: true; protocol: HangingProtocolDef; selectedPrior: DicomStudy | null; missingPrior: boolean }
  | { matched: false; reason: string };

// Select the best hanging protocol for a given study + available priors.
// If the protocol wants a prior but none is available: return matched:true, missingPrior:true, selectedPrior:null.
// If no protocol matches: return matched:false.
export function selectHangingProtocol(
  study: DicomStudy,
  availablePriors: DicomStudy[],
  protocols: HangingProtocolDef[]
): HangingProtocolResult;
```

how to implement:
1. Create `src/core/hanging-protocol.ts`.
2. `selectHangingProtocol`:
   - Find protocols where `protocol.modality === study.modalities[0]` and (`protocol.bodyPart === '*'` or `protocol.bodyPart === study.series[0]?.bodyPart` — use the study's series list for body part).
   - If none found → `{ matched: false, reason: 'no protocol for modality/body-part' }`.
   - Select the most specific match (body-part-specific beats `'*'`).
   - If `priorSelectionStrategy === 'most-recent-same-modality-same-body-part'`: filter `availablePriors` by same modality + same body part; sort by `studyDate` descending; take the first. If none: `missingPrior: true`, `selectedPrior: null`.
3. Create `src/fixtures/hanging-protocol-fixtures.ts` with 4 protocol definitions: CT chest, MR brain, XR chest, US abdomen.
4. Create `test/hanging-protocol.test.ts` using the fixture protocols and fixture studies.

acceptance (four modality fixtures):
- A CT chest study with one available CT chest prior → `matched: true`, `selectedPrior !== null`, `missingPrior: false`.
- A CT chest study with no available priors → `matched: true`, `selectedPrior: null`, `missingPrior: true`.
- An MR brain study → selects the MR brain protocol (layout, sync groups).
- An XR hand study (no specific protocol) → falls back to XR `bodyPart: '*'` if one exists, or `matched: false` if not.
- A cross-modality mismatch: passing CT study to selectHangingProtocol with only an MR brain protocol → `matched: false`.
Run `npm test` → green.

---

**R09 — Identity reconciliation + conservative merge**
dependsOn: R01, R03, R04
files: `src/core/identity-reconciliation.ts`, `src/fixtures/identity-fixtures.ts`, `test/identity-reconciliation.test.ts`

interface:
```ts
export type DemographicRecord = { patientId: PatientId; name: string; birthDate: string; sex?: string };
export type MergeEvidence = { field: string; sourceValue: string; targetValue: string; match: boolean };
export type MergeProposal = {
  id: string;
  sourcePatientId: PatientId;
  targetPatientId: PatientId;
  evidence: MergeEvidence[];
  matchScore: number;        // 0.0–1.0: fraction of compared fields that match
  status: IdentityMergeStatus;
  authorizedBy?: string;
  mergedAt?: Date;
  reversedAt?: Date;
};

// Compute evidence by comparing demographics field-by-field.
// Threshold: matchScore < 0.8 → status: 'quarantined'; matchScore >= 0.8 but any critical field (name/birthDate) mismatches → still 'quarantined'.
// Status 'pending' means proposed but not yet authorized.
// Never auto-confirm; only the explicit `confirmMerge` call may set status to 'confirmed'.
export function proposeMerge(source: DemographicRecord, target: DemographicRecord): MergeProposal;

// Confirm a 'pending' or 'quarantined' proposal. Requires authorizedBy.
// Returns a new proposal with status 'confirmed', mergedAt: clock.now(). Appends an AuditEvent.
export function confirmMerge(proposal: MergeProposal, authorizedBy: string, clock: Clock, auditLog: AuditLog): MergeProposal;

// Reverse a 'confirmed' merge. Returns a new proposal with status 'rejected', reversedAt: clock.now(). Appends an AuditEvent.
export function reverseMerge(proposal: MergeProposal, authorizedBy: string, clock: Clock, auditLog: AuditLog): MergeProposal;
```

how to implement:
1. Create `src/core/identity-reconciliation.ts`.
2. `proposeMerge`: compare `name` (case-insensitive), `birthDate` (exact), `sex` (if both present). Compute `matchScore = matchingFields / totalComparedFields`. If `matchScore < 0.8` OR name mismatches OR birthDate mismatches → `status: 'quarantined'`. Else `status: 'pending'`. Never `'confirmed'` from `proposeMerge`.
3. `confirmMerge`: throw if `proposal.status` is not `'pending'` or `'quarantined'`; return new proposal with `status: 'confirmed'`, `mergedAt: clock.now()`; append AuditEvent `'identity-merge'`.
4. `reverseMerge`: throw if `proposal.status !== 'confirmed'`; return new proposal with `status: 'rejected'`, `reversedAt: clock.now()`; append AuditEvent `'identity-unmerge'`.
5. Create `src/fixtures/identity-fixtures.ts` with: (a) two patients with identical demographics (should → `pending`); (b) two patients with one-character name difference ("John Smith" vs. "John Smyth") and same DOB (should → `quarantined`); (c) a "John Doe / Unknown" trauma patient and a real patient (should → `quarantined`).
6. Create `test/identity-reconciliation.test.ts`.

acceptance:
- Exact match demographics → `proposeMerge` returns `status: 'pending'`, `matchScore === 1.0`.
- One-character name mismatch → `status: 'quarantined'`.
- `confirmMerge` on a `quarantined` proposal → succeeds (status `'confirmed'`) with an AuditEvent.
- `confirmMerge` on an already-`'confirmed'` proposal → throws.
- `reverseMerge` on `'confirmed'` → status `'rejected'`, second AuditEvent appended.
- Auto-confirm never happens: `proposeMerge` never returns `'confirmed'` regardless of inputs.
Run `npm test` → green.

---

**R10 — Report lifecycle (draft → preliminary → final → addendum)**
dependsOn: R01, R02, R03
files: `src/core/report-lifecycle.ts`, `test/report-lifecycle.test.ts`

interface:
```ts
export type RadiologyReport = {
  id: string;
  studyInstanceUID: StudyInstanceUID;
  patientId: PatientId;
  status: ReportStatus;
  radiologistId: string;
  createdAt: Date;
  finalizedAt?: Date;
  content: string;   // report text
  versionId: string;
  addenda: ReportAddendum[];
};
export type ReportAddendum = {
  id: string;
  parentVersionId: string;
  authorId: string;
  reason: string;
  addedAt: Date;
  content: string;
};

// Transition draft → preliminary. Throws if not draft.
export function submitPreliminary(report: RadiologyReport, clock: Clock, auditLog: AuditLog): RadiologyReport;

// Transition preliminary → final. Throws if not preliminary.
export function finalizeReport(report: RadiologyReport, clock: Clock, auditLog: AuditLog): RadiologyReport;

// Add an addendum to a final report. Throws if not final.
// Returns a new report with addendum appended. Original unchanged.
export function addAddendum(report: RadiologyReport, authorId: string, reason: string, content: string, clock: Clock, auditLog: AuditLog): RadiologyReport;

// Attempt direct in-place edit of a final report. MUST THROW with message 'final reports are immutable'.
export function attemptDirectEdit(report: RadiologyReport, newContent: string): never;
```

how to implement:
1. Create `src/core/report-lifecycle.ts`.
2. Each transition: check current status, throw on invalid transition, return a new object (never mutate), append AuditEvent `'report-transition'` with `details: { from, to }`.
3. `addAddendum`: if `report.status !== 'final'` throw; else return `{ ...report, addenda: [...report.addenda, newAddendum] }`.
4. `attemptDirectEdit`: always throws `Error('final reports are immutable')`.
5. Create `test/report-lifecycle.test.ts`.

acceptance:
- `draft → preliminary → final`: each step succeeds, returns new object with updated status; each step appends one AuditEvent.
- Calling `finalizeReport` on a draft report (skipping preliminary) throws.
- After finalization, `addAddendum` succeeds and the original report object has `addenda.length === 0`.
- `attemptDirectEdit` always throws `'final reports are immutable'`.
- After K addenda, the finalized content (`report.content`) is unchanged (reconstruct the original by accessing the base report's `content`).
Run `npm test` → green.

---

**R11 — Critical-result notification state machine**
dependsOn: R01, R02, R03, R10
files: `src/core/critical-result.ts`, `test/critical-result.test.ts`

interface:
```ts
export type CriticalResult = {
  id: string;
  reportId: string;
  studyInstanceUID: StudyInstanceUID;
  patientId: PatientId;
  tier: CriticalResultTier;
  status: CriticalResultStatus;
  notifiedAt: Date;
  acknowledgedAt?: Date;
  escalatedAt?: Date;
  slaDueAt: Date;   // notifiedAt + tier SLA: critical=1h, urgent=4h, routine=24h
};

export const CRITICAL_RESULT_SLA_MS: Record<CriticalResultTier, number> = {
  critical: 60 * 60 * 1000,        // 1 hour
  urgent: 4 * 60 * 60 * 1000,      // 4 hours
  routine: 24 * 60 * 60 * 1000,    // 24 hours
};

// Create a new CriticalResult. Appends an AuditEvent.
export function notifyCriticalResult(reportId: string, studyUID: StudyInstanceUID, patientId: PatientId, tier: CriticalResultTier, notifiedBy: string, clock: Clock, auditLog: AuditLog): CriticalResult;

// Acknowledge. Throws if already acknowledged. Returns new CriticalResult. Appends AuditEvent.
export function acknowledgeCriticalResult(result: CriticalResult, acknowledgedBy: string, clock: Clock, auditLog: AuditLog): CriticalResult;

// Check escalation: if status !== 'acknowledged' AND clock.now() > slaDueAt → return escalated. Appends AuditEvent.
export function checkEscalation(result: CriticalResult, clock: Clock, auditLog: AuditLog): CriticalResult;
```

how to implement:
1. Create `src/core/critical-result.ts` with the constant and three functions.
2. `notifyCriticalResult`: compute `slaDueAt = new Date(clock.now().getTime() + CRITICAL_RESULT_SLA_MS[tier])`. Append `'critical-result-notification'` AuditEvent.
3. `acknowledgeCriticalResult`: throw if `result.status !== 'notified'`; return new result with `status: 'acknowledged'`, `acknowledgedAt: clock.now()`. Append `'critical-result-acknowledged'`.
4. `checkEscalation`: if `result.status !== 'acknowledged'` AND `clock.now() > result.slaDueAt` → return new result with `status: 'escalated'`, `escalatedAt: clock.now()`; append `'critical-result-escalated'`. Otherwise return the result unchanged.
5. Create `test/critical-result.test.ts`.

acceptance:
- `critical` tier: `slaDueAt` is exactly 1 hour after `notifiedAt`.
- `checkEscalation` on a `notified` result with clock 61 minutes after notification → `status: 'escalated'`, AuditEvent appended.
- `checkEscalation` on an `acknowledged` result (any time) → no escalation, status unchanged.
- `acknowledgeCriticalResult` on an already-acknowledged result throws.
Run `npm test` → green.

---

**R12 — Dose & quality tracker**
dependsOn: R01, R03, R04
files: `src/core/dose-tracker.ts`, `src/fixtures/dose-fixtures.ts`, `test/dose-tracker.test.ts`

interface:
```ts
export type CtDoseEvent = {
  id: string;
  studyInstanceUID: StudyInstanceUID;
  patientId: PatientId;
  modality: 'CT';
  ctdiVol: number;     // mGy, measured
  dlp: number;         // mGy·cm = ctdiVol × scanLengthCm
  ssde?: number;       // optional: CTDIvol × size-scaling factor (placeholder)
  drlCtdiVol: number;  // Diagnostic Reference Level for this protocol
  drlDlp: number;
  exceedsDrl: boolean; // ctdiVol > drlCtdiVol OR dlp > drlDlp
  flags: DoseQualityFlag[];
};
export type DoseQualityFlag = 'repeated-study' | 'missing-metadata' | 'rejected-image' | 'burned-in-phi' | 'protocol-deviation';

// Evaluate a CT acquisition for dose/quality flags.
export function evaluateDoseEvent(
  studyUID: StudyInstanceUID,
  patientId: PatientId,
  ctdiVol: number,
  dlp: number,
  drlCtdiVol: number,
  drlDlp: number,
  burnedInAnnotation: boolean,
  missingMetadata: boolean,
  rejectedImages: number,
  auditLog: AuditLog,
  clock: Clock
): CtDoseEvent;
```

how to implement:
1. Create `src/core/dose-tracker.ts`.
2. `evaluateDoseEvent`:
   - `exceedsDrl = ctdiVol > drlCtdiVol || dlp > drlDlp`.
   - Collect `flags`: if `burnedInAnnotation` → `'burned-in-phi'`; if `missingMetadata` → `'missing-metadata'`; if `rejectedImages > 0` → `'rejected-image'`.
   - Append AuditEvent `'dose-event'`.
3. Create `src/fixtures/dose-fixtures.ts` with one normal CT dose (within DRL) and one over-DRL CT dose.
4. Create `test/dose-tracker.test.ts`.

acceptance:
- Over-DRL fixture: `exceedsDrl === true`.
- Within-DRL fixture: `exceedsDrl === false`.
- `burnedInAnnotation: true` → `flags` includes `'burned-in-phi'`.
- Each call appends exactly one AuditEvent.
Run `npm test` → green.

---

**R13 — De-identification export adapter (fixture-only)**
dependsOn: R01, R04
files: `src/adapters/deidentification-adapter.ts`, `test/deidentification.test.ts`

interface:
```ts
// The 18 HIPAA Safe Harbor identifiers relevant to DICOM headers:
export const HIPAA_18_TAGS_TO_STRIP = [
  'patientName', 'patientBirthDate', 'patientAddress', 'patientPhoneNumber',
  'patientId', 'accessionNumber', 'studyDate',     // date: retain year only → 'YYYY0101'
  'studyDescription',  // may contain patient name
  // (list the remaining as comment placeholders; these 8 cover the test cases)
];

export type DeidentifiedStudy = Omit<DicomStudy, 'patientId' | 'accessionNumber' | 'studyDescription'> & {
  pseudoId: string;           // random-looking but deterministic within a batch
  studyYearOnly: string;      // YYYY0101 from studyDate
  deidentified: true;
};

// Returns a deidentified study if safe to export (burnedInAnnotation === false on all instances).
// Returns null + reason if any instance has burnedInAnnotation === true.
export type DeidentResult =
  | { safe: true; study: DeidentifiedStudy }
  | { safe: false; reason: 'burned-in-phi'; studyInstanceUID: StudyInstanceUID };

export function deidentifyStudy(
  study: DicomStudy,
  instances: DicomInstance[],
  batchIndex: number   // used for deterministic pseudo-id generation
): DeidentResult;
```

how to implement:
1. Create `src/adapters/deidentification-adapter.ts`.
2. Check `instances.some(i => i.burnedInAnnotation)` → if true return `{ safe: false, reason: 'burned-in-phi', studyInstanceUID: study.studyInstanceUID }`.
3. Build `DeidentifiedStudy`: strip the listed fields, retain modalities, set `studyYearOnly: study.studyDate.slice(0, 4) + '0101'`, set `pseudoId: 'DEID-' + batchIndex.toString().padStart(4, '0')`, set `deidentified: true`.
4. Create `test/deidentification.test.ts`.

acceptance:
- A study with no burned-in instances → `{ safe: true }`, `deidentified: true`, `pseudoId` set, `studyDate` not present.
- A study with one burned-in instance → `{ safe: false, reason: 'burned-in-phi' }`.
- `deidentifiedStudy.patientId` does not exist (field stripped).
Run `npm test` → green.

---

**R14 — RADPEER discrepancy review**
dependsOn: R01, R10
files: `src/core/discrepancy-review.ts`, `test/discrepancy-review.test.ts`

interface:
```ts
// RADPEER 4-point concordance scale:
// 1 = agree / minor variant, clinically insignificant
// 2 = disagree, but not expected to affect management
// 3 = disagree, and may have affected management
// 4 = disagree, and likely affected management (clinically significant discrepancy)
export type DiscrepancyReview = {
  id: string;
  reportId: string;
  reviewerId: string;
  radpeerScore: RadpeerScore;
  comment: string;
  reviewedAt: Date;
};

export function submitDiscrepancyReview(
  reportId: string,
  reviewerId: string,
  radpeerScore: RadpeerScore,
  comment: string,
  clock: Clock,
  auditLog: AuditLog
): DiscrepancyReview;
```

how to implement:
1. Create `src/core/discrepancy-review.ts`.
2. `submitDiscrepancyReview`: create the record, append `'report-transition'` AuditEvent with `details: { radpeerScore: String(radpeerScore) }`, return the record.
3. Create `test/discrepancy-review.test.ts`.

acceptance:
- A score-4 review is created with the correct `radpeerScore` and timestamp from the clock.
- Exactly one AuditEvent is appended per call.
Run `npm test` → green.

---

**R15 — Seeded imaging-day fixture**
dependsOn: R01 through R14
files: `src/fixtures/imaging-day.ts`, `test/imaging-day.test.ts`

interface:
```ts
export const IMAGING_DAY: {
  patients: DicomPatient[];
  studies: DicomStudy[];
  series: DicomSeries[];
  instances: DicomInstance[];     // at least one with burnedInAnnotation: true
  worklistItems: WorklistItem[];  // includes one STAT item
  mergeProposals: { source: DemographicRecord; target: DemographicRecord }[];  // one ambiguous pair
};
```

how to implement:
1. Create `src/fixtures/imaging-day.ts` covering all E4 adversarial scenarios:
   - CT study with anisotropic pixelSpacing `{ rowMm: 0.5, colMm: 1.2 }` (for the anisotropic-measurement-trap test).
   - MR brain study with a prior MR brain study (for the missing-prior test: a second CT chest study with no prior).
   - An XR study.
   - A US study.
   - One instance with `burnedInAnnotation: true`.
   - One STAT worklist item.
   - Two demographic records with a one-character name difference (the wrong-patient merge risk).
2. Create `test/imaging-day.test.ts`.

acceptance:
- `IMAGING_DAY` type-checks.
- At least one instance has `burnedInAnnotation: true`.
- At least one worklist item has `statFlag: true`.
- At least two studies have different modalities.
Run `npm test` → green.

---

**R16 — Adversarial scenario integration tests (E4)**
dependsOn: R01 through R15
files: `test/adversarial.test.ts`

interface: No new production code. Integration test.

how to implement: Create `test/adversarial.test.ts` and test each E4 scenario:

1. **Anisotropic measurement trap**: use the CT instance with `pixelSpacing: { rowMm: 0.5, colMm: 1.2 }`. Measure between `{ i:0, j:0 }` and `{ i:2, j:3 }`. Expected patient-mm Euclidean distance (by hand: P_a={0,0,0}, P_b={2*1.2, 3*0.5, 0}={2.4,1.5,0}, distance=√(2.4²+1.5²)=√(5.76+2.25)=√8.01≈2.832). Assert `measureLength` returns `value ≈ 2.832` (within 0.001). Assert that pixel-counting (i=2,j=3, spacing=1.0 → 3.606) is wrong — the test checks the correct formula, not the pixel-count shortcut.

2. **Wrong-patient merge risk**: use `IMAGING_DAY.mergeProposals[0]` (name mismatch). Assert `proposeMerge` returns `status: 'quarantined'`.

3. **Missing prior**: use the CT chest study from `IMAGING_DAY` that has no prior CT chest. `selectHangingProtocol` with only an MR prior available → `missingPrior: true`, `selectedPrior: null`.

4. **Finalized-report mutation attempt**: create a report, transition to final, call `attemptDirectEdit` → throws `'final reports are immutable'`.

5. **Unacknowledged critical result**: notify a `'critical'` result, advance clock by 2 hours, call `checkEscalation` → `status: 'escalated'`. Notify the same tier, acknowledge it, advance clock by 2 hours, call `checkEscalation` → status still `'acknowledged'`.

6. **Burned-in-PHI export**: call `deidentifyStudy` with one burned-in instance → `safe: false`.

7. **STAT jumps the queue**: `prioritizeWorklist([routine-older, stat-newer, routine-sla-breached, ...], clock)` → STAT item is at index 0 regardless of receivedAt.

8. **Orphan instance rejected**: construct a `DicomFixtureTree` with an instance whose `seriesInstanceUID` is not in the series list → `parseDicomTree` returns `valid: false`.

acceptance: All 8 scenario assertions pass. `npm test` → green.

---

**R17 — Property-based invariant tests (E5)**
dependsOn: R01 through R16
files: `test/invariants.test.ts`

interface: No new production code. Property tests.

how to implement: Create `test/invariants.test.ts` and test E5 invariants:

1. **Hierarchy referential integrity (fuzz)**: generate 10 trees with randomly dropped series entries (using a seeded RNG — simple LCG, seed=42). Assert `parseDicomTree` returns `valid: false` for all of them.

2. **Geometry correctness**: for 5 pairs of `{rowMm, colMm}` spacings — `(1,1)`, `(0.5,0.5)`, `(0.5,1.2)`, `(2,0.5)`, `(0.9,0.7)` — and identity IOP, compute `pixelToPatient({i:3,j:4}, plane)` and assert against the analytic value `{3*colMm, 4*rowMm, 0}` (within 1e-6). Assert `measureLength` gives the same result as the closed-form Euclidean distance.

3. **Report immutability**: for a finalized report with 3 addenda, assert the base `report.content` is character-for-character identical to the content before finalization. Assert `addenda.length === 3`.

4. **Merge reversibility**: propose + confirm + reverse a merge. Assert the final status is `'rejected'`, `reversedAt` is set, and the AuditLog has exactly 2 events (one merge, one unmerge).

5. **Critical-result closed-loop**: create 5 results at different tiers; advance clock past each SLA; assert every unacknowledged one escalates; acknowledge 2 of them before the clock advances — assert those 2 do not escalate.

6. **Audit totality**: run all adversarial scenarios from R16 in sequence with a single `AuditLog` instance. Assert `auditLog.getAll().length > 0` and every event has a non-empty `patientId`.

acceptance: All invariant assertions pass. `npm test` → green.

---

**R18 — Full flagship integration test**
dependsOn: R01 through R17
files: `test/integration.test.ts`

interface: No new production code.

how to implement: Create `test/integration.test.ts` and run the E3 "flagship test":

1. Parse `IMAGING_DAY` through `parseDicomTree` → assert `valid: true`.
2. `prioritizeWorklist(IMAGING_DAY.worklistItems, clock)` → assert STAT item is first.
3. For each study in `IMAGING_DAY`, call `selectHangingProtocol` → assert each returns a valid `HangingProtocolResult` (no unhandled crash).
4. Compute `measureLength` on the anisotropic CT instance → assert correct mm value.
5. The ambiguous merge proposal from `IMAGING_DAY.mergeProposals[0]` → `proposeMerge` returns `'quarantined'`; manually confirm → status `'confirmed'`; reverse → status `'rejected'`.
6. Create a preliminary CT report → finalize → add one addendum → assert original content unchanged and `addenda.length === 1`.
7. Notify a `'critical'` result → advance clock past SLA → `checkEscalation` → assert `'escalated'`.
8. Deidentify a study with the burned-in instance → assert `safe: false`.
9. Assert `auditLog.getAll()` has at least one entry per major workflow step (study parse does not create audit events, but merge/report/critical-result do).
10. Assert zero network calls (the test runs with no network — there are none to check, but the reader should note: if any import tries to fetch, Vitest will error on the network call).

acceptance: All 10 steps pass. `npm test` → green.

---

### 3. Decomposition method for the rest of the spec

After the first slice (R01–R18) passes, expand remaining breadth using this recipe:

**Recipe: one feature cluster = one dependency group of 2–4 small cards**

For each remaining feature:
1. **Types extension card**: add new types to `src/core/types.ts` or a new `src/core/<feature>-types.ts`.
2. **Pure-logic card**: one module in `src/core/`, no I/O.
3. **Fixture card**: add fixture data to `src/fixtures/`.
4. **Acceptance card**: `test/<feature>.test.ts` with the three most load-bearing assertions.

**Worked example A — HL7 v2 ORM order intake adapter**

Break into 3 cards:
- `R19` — `OrmOrder` type: `{ messageType: 'ORM^O01'; patientId: string; accessionNumber: string; modality: string; scheduledDate: string; priority: 'STAT' | 'ROUTINE' }`. dependsOn: R01. files: `src/core/hl7-types.ts`. Acceptance: type-checks.
- `R20` — `parseOrmToWorklistItem(msg: OrmOrder): WorklistItem`. dependsOn: R07, R19. files: `src/adapters/hl7-order-adapter.ts`. Maps `priority: 'STAT'` → `statFlag: true`, computes `slaDueAt` from scheduledDate + 4h for STAT / 24h for routine. Acceptance: STAT ORM → `statFlag: true`, `slaDueAt` is 4h after scheduled; ROUTINE ORM → `statFlag: false`.
- `R21` — Fixture canned ORM messages + adapter smoke test. dependsOn: R20. files: `src/fixtures/hl7-fixtures.ts`, `test/hl7-order.test.ts`. Acceptance: one STAT and one ROUTINE ORM each produce the correct `WorklistItem`.

**Worked example B — Measurement timepoint comparison**

Break into 2 cards:
- `R22` — `compareTimepoints(measurementA: Measurement, studyA: DicomStudy, measurementB: Measurement, studyB: DicomStudy): { delta: number | null; unit: 'mm'; studyADate: string; studyBDate: string; spacingMismatch: boolean }`. If either measurement is `FlaggedMeasurement` (value null) or both spacing values differ by > 10% → set `spacingMismatch: true`, `delta: null`. Otherwise `delta = measurementB.value - measurementA.value`. dependsOn: R06. files: `src/core/timepoint-comparison.ts`. Acceptance: two valid measurements → correct delta; one flagged → `delta: null`.
- `R23` — Fixture: a lesion measured at 12mm on the prior MR brain and 15mm on the current MR brain (using the fixture planes with known spacing). `compareTimepoints` → `delta === 3` (within 0.001). dependsOn: R22, R15. files: `test/timepoint-comparison.test.ts`. Acceptance: delta is 3.0 (±0.001).

**Worked example C — Worklist SLA tracking over time**

Break into 2 cards:
- `R24` — Extend `WorklistItem` with `completedAt?: Date`. Add `completeWorklistItem(item, clock, auditLog) → WorklistItem` that sets `status: 'completed'`, `completedAt: clock.now()`. Append `'worklist-update'` AuditEvent. dependsOn: R07. files: `src/core/worklist.ts` (edit). Acceptance: calling complete sets `status === 'completed'` and appends AuditEvent.
- `R25` — Property test: for a fixed set of 10 items at various `slaDueAt` offsets from the clock, assert that after prioritization all SLA-breached items (non-STAT) precede all non-breached non-STAT items. dependsOn: R07, R24. files: `test/worklist-sla.test.ts`. Acceptance: verified for 10 generated cases.

---

### 4. Per-task implementation conventions

**File/folder layout**

```
src/
  core/             # pure domain logic — no I/O, no binaries
    types.ts        # R01: all shared type definitions
    clock.ts        # R02
    fixed-clock.ts
    audit-log.ts    # R03
    dicom-model.ts  # R04
    dicom-parser.ts # R05
    geometry.ts     # R06
    worklist.ts     # R07
    hanging-protocol.ts  # R08
    identity-reconciliation.ts  # R09
    report-lifecycle.ts  # R10
    critical-result.ts  # R11
    dose-tracker.ts # R12
    discrepancy-review.ts  # R14
  adapters/         # named I/O boundary adapters — tests use fixture implementations
    deidentification-adapter.ts  # R13
    pixel-data-loader.ts         # stub (never called in tests)
  fixtures/         # static deterministic data
    dicom-fixtures.ts
    hanging-protocol-fixtures.ts
    worklist-fixtures.ts
    dose-fixtures.ts
    identity-fixtures.ts
    imaging-day.ts
test/               # one file per card
```

**Naming conventions**
- UIDs: branded strings (`StudyInstanceUID`, `SeriesInstanceUID`, `SOPInstanceUID`).
- Coordinates: always `LpsPoint` with `{x,y,z}` — never bare `[x,y,z]` arrays.
- Spacings: always `{ rowMm, colMm }` — never a bare `[row, col]` tuple (avoids index confusion).
- Report transitions: always return a new object; never mutate.

**How to write a geometry test**

```ts
// test/geometry.test.ts
import { describe, it, expect } from 'vitest';
import { pixelToPatient } from '../src/core/geometry.js';

describe('pixelToPatient', () => {
  it('identity IOP, isotropic 1mm: pixel (3,4) → patient (3,4,0)', () => {
    const plane = {
      ipp: { x: 0, y: 0, z: 0 },
      iop: { rowDir: { x: 1, y: 0, z: 0 }, colDir: { x: 0, y: 1, z: 0 } },
      pixelSpacing: { rowMm: 1, colMm: 1 },
    };
    const pt = pixelToPatient({ i: 3, j: 4 }, plane);
    expect(pt.x).toBeCloseTo(3, 6);
    expect(pt.y).toBeCloseTo(4, 6);
    expect(pt.z).toBeCloseTo(0, 6);
  });
});
```

**How to keep it deterministic**
- All fixture acquisition times: `'20250115'` (YYYYMMDD string for DICOM dates).
- All clock values: `new FixedClock(new Date('2025-01-15T08:00:00Z'))`.
- Seeded LCG for fuzz tests: `let seed = 42; const rng = () => { seed = (seed * 1664525 + 1013904223) % 2**32; return seed / 2**32; };`.
- Float comparisons: always `toBeCloseTo(expected, 4)` (4 decimal places minimum for geometric values).

**Definition of done for any card**
1. `npm test` exits 0.
2. `tsc --noEmit` exits 0.
3. Test file has at least one passing assertion per exported function.
4. No production module calls `Date.now()`, `Math.random()`, or makes any network call.
5. No `any` type in production files.
6. No real DICOM binaries anywhere in the test suite.

---

### 5. Common pitfalls for a weak model on this project

**Pitfall 1 — Getting the pixelSpacing row/col convention backwards**
`PixelSpacing[0]` in DICOM is the *row spacing* (distance between rows = the column pitch — how far you move in the column direction when you advance one row). `PixelSpacing[1]` is the *column spacing*. The formula `P = IPP + i * (rowDir * colSpacing) + j * (colDir * rowSpacing)` uses `i` (row index) multiplied by `colMm` (column pitch) — this is the correct DICOM convention. A model that multiplies `i * rowMm` will produce wrong patient coordinates on anisotropic fixtures. The R16 anisotropic fixture test is designed to catch exactly this: with `{ rowMm: 0.5, colMm: 1.2 }`, `i=2, j=3`, the correct answer is `P = {2*1.2, 3*0.5, 0} = {2.4, 1.5, 0}` — not `{2*0.5, 3*1.2, 0} = {1.0, 3.6, 0}`.

**Pitfall 2 — Auto-confirming identity merges**
The most dangerous silent mistake: `proposeMerge` should never return `status: 'confirmed'`. Only `confirmMerge` may do that. A model that treats `matchScore >= 0.8` as an automatic confirm will fail the adversarial test (the wrong-patient merge with `matchScore = 0.85` from a one-field mismatch must still be quarantined if name or birthDate mismatches). The fix: `proposeMerge` returns `'quarantined'` whenever any critical field (name, birthDate) mismatches — regardless of `matchScore`.

**Pitfall 3 — Mutating a finalized report**
A 3B model will try to update `report.status = 'amended'` in place. This breaks the immutability invariant (R17 §3). Every transition function must `return { ...report, ... }` — a new object. The `Object.isFrozen` check is optional but `attemptDirectEdit` is a hard test that throws on purpose; if the model turns it into a silent edit, R16 test 4 fails.

**Pitfall 4 — Orphan instances silently flattening the hierarchy**
A model that does `instances.push(...tree.series.flatMap(s => s.instances))` without checking referential integrity will accept malformed trees. The R16 test 8 (orphan instance rejected) catches this. The parser must explicitly check every instance's `seriesInstanceUID` against the series set before accepting the tree.

**Pitfall 5 — Using real wall-clock time in escalation and SLA logic**
If `checkEscalation` or `checkSla` calls `new Date()` instead of `clock.now()`, the test will pass at one time of day and fail at another. The tell-tale: a test that fails only when run "too close to the SLA deadline." Every time read must be through the injected `Clock`.

**Pitfall 6 — Cross-modality prior selection**
The hanging-protocol engine must reject an MR prior when the study is a CT. A model that selects the most recent prior by `studyDate` without checking modality + body part will fail the E4 cross-modality fixture. The guard is: `availablePriors.filter(p => p.modalities.includes(study.modalities[0]) && matchesBodyPart(p, study))`.

**Pitfall 7 — Missing `burned-in-phi` guard in de-identification**
A model that strips DICOM headers without checking `BurnedInAnnotation` will return `safe: true` for a study with PHI burned into pixels. The R13 test catches this — the function must check `instances.some(i => i.burnedInAnnotation)` before returning `safe: true`.

**Pitfall 8 — Forgetting the dependency order for geometry → measurements → reports**
The geometry module (R06) must exist before measurements can be tested, which must exist before R16's anisotropic fixture test can run. A model that tries to write `test/adversarial.test.ts` before R06 is implemented will get compile errors. Follow the card order: R01 → R02 → R03 → R04 → R05 → R06 → R07 → R08 → R09 → R10 → R11 → R12 → R13 → R14 → R15 → R16 → R17 → R18.
