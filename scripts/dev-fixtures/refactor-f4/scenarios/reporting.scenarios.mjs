/**
 * The reporting behaviour this refactor must preserve, exactly. FROZEN: evidence, not workspace.
 *
 * Parsing, rejection reasons, aggregation order, rounding and column widths are all observable, and each is pinned
 * by the scenario that owns it so a restructuring that drops one is named precisely.
 */

const INPUT = [
	"# expenses for the week",
	"travel,ana,100.00",
	"meals,bo,12.50",
	"travel,cy,50",
	"",
	"hardware,ana,1000",
	"nonsense,ana,1",
	"meals,,4.00",
	"travel,dee,12.345",
	"meals,ed,-3.00",
	"travel,ana",
].join("\n");

export const scenarios = [
	{
		id: "B01",
		title: "blank lines and # comments are skipped, not rejected",
		entry: "buildReport",
		assert: (buildReport, assert) => {
			const report = buildReport("# a\n\n   \ntravel,ana,1.00", {});
			assert.equal(report.rejected.length, 0);
			assert.equal(report.aggregates.length, 1);
		},
	},
	{
		id: "B02",
		title: "each rejection carries a 1-based line number and a specific reason",
		entry: "buildReport",
		assert: (buildReport, assert) => {
			assert.deepEqual(buildReport(INPUT, {}).rejected, [
				{ line: 7, reason: "unknown category nonsense" },
				{ line: 8, reason: "missing owner" },
				{ line: 9, reason: "bad amount 12.345" },
				{ line: 10, reason: "refunds are not allowed" },
				{ line: 11, reason: "expected three fields" },
			]);
		},
	},
	{
		id: "B03",
		title: "refunds are rejected unless allowRefunds is set, and then they subtract",
		entry: "buildReport",
		assert: (buildReport, assert) => {
			const strict = buildReport("meals,ed,10.00\nmeals,ed,-3.00", {});
			assert.equal(strict.totalMinor, 1000);
			assert.equal(strict.rejected.length, 1);
			const lenient = buildReport("meals,ed,10.00\nmeals,ed,-3.00", { allowRefunds: true });
			assert.equal(lenient.totalMinor, 700);
			assert.equal(lenient.rejected.length, 0);
			// Options are optional in every form.
			assert.equal(buildReport("meals,ed,10.00").totalMinor, 1000);
			assert.equal(buildReport("meals,ed,10.00", undefined).totalMinor, 1000);
		},
	},
	{
		id: "B04",
		title: "amounts are minor units, and two decimals are exact",
		entry: "buildReport",
		assert: (buildReport, assert) => {
			assert.equal(buildReport("meals,ed,0.07", {}).totalMinor, 7);
			assert.equal(buildReport("meals,ed,50", {}).totalMinor, 5000);
			assert.equal(buildReport("meals,ed,1.1", {}).totalMinor, 110);
			// Three decimals are not an amount at all.
			assert.equal(buildReport("meals,ed,1.005", {}).aggregates.length, 0);
		},
	},
	{
		id: "B05",
		title: "aggregates come back in CATEGORIES order, with sorted unique owners and a rounded average",
		entry: "buildReport",
		assert: (buildReport, assert) => {
			const report = buildReport(INPUT, {});
			assert.deepEqual(
				report.aggregates.map((entry) => entry.category),
				["travel", "meals", "hardware"],
			);
			const travel = report.aggregates[0];
			assert.deepEqual(travel, {
				category: "travel",
				totalMinor: 15000,
				count: 2,
				owners: ["ana", "cy"],
				averageMinor: 7500,
			});
			// An average that does not divide evenly rounds to the nearest minor unit.
			assert.equal(buildReport("meals,a,1.00\nmeals,b,1.01\nmeals,c,1.00", {}).aggregates[0].averageMinor, 100);
		},
	},
	{
		id: "B06",
		title: "the same owner twice counts twice but is listed once",
		entry: "buildReport",
		assert: (buildReport, assert) => {
			const entry = buildReport("meals,ana,1.00\nmeals,ana,2.00", {}).aggregates[0];
			assert.deepEqual(entry.owners, ["ana"]);
			assert.equal(entry.count, 2);
			assert.equal(entry.totalMinor, 300);
		},
	},
	{
		id: "B07",
		title: "the table pads to the widest CATEGORY name and ends with a TOTAL row over accepted rows",
		entry: "buildReport",
		assert: (buildReport, assert) => {
			const report = buildReport(INPUT, {});
			assert.deepEqual(report.table.split("\n"), [
				"travel        150.00    2",
				"meals          12.50    1",
				"hardware     1000.00    1",
				"TOTAL        1162.50    4",
			]);
			// Empty input still renders the TOTAL row.
			assert.equal(buildReport("", {}).table, "TOTAL           0.00    0");
		},
	},
	{
		id: "B08",
		title: "the CSV export has a header and one row per aggregate, owners space-joined",
		entry: "exportReportCsv",
		assert: async (exportReportCsv, assert) => {
			const { buildReport } = await import("../src/index.mjs");
			assert.deepEqual(exportReportCsv(buildReport(INPUT, {})).split("\n"), [
				"category,total,count,owners",
				"travel,150.00,2,ana cy",
				"meals,12.50,1,bo",
				"hardware,1000.00,1,ana",
			]);
		},
	},
	{
		id: "B09",
		title: "a receipt is fixed-width: category 8, owner 12, amount right-aligned in 10",
		entry: "renderReceipt",
		assert: (renderReceipt, assert) => {
			assert.equal(renderReceipt({ category: "meals", who: "bo", amountMinor: 1250 }), "meals   bo               12.50");
			assert.equal(renderReceipt({ category: "hardware", who: "ana", amountMinor: 100000 }), "hardwareana            1000.00");
			assert.equal(renderReceipt({ category: "meals", amountMinor: 0 }), "meals                     0.00");
			assert.throws(() => renderReceipt(null), TypeError);
			assert.throws(() => renderReceipt({ who: "bo" }), TypeError);
		},
	},
];
