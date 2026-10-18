import { open, shot } from "./lib.mjs";
const { b, p } = await open({ exams: [] });
await shot(p, "a-home-empty");
// Board exam from the list
await p.getByRole("button", { name: "Add exam" }).click(); await p.waitForTimeout(500);
await shot(p, "b1-add-exam");
await p.getByRole("button", { name: /Which exam|PANCE/ }).first().click(); await p.waitForTimeout(400);
await shot(p, "b2-exam-list");
await p.getByRole("option", { name: "PANCE" }).click().catch(async () => { await p.locator("[role=dialog] >> text=PANCE").nth(1).click(); });
await p.waitForTimeout(300);
await p.getByText("Choose exam date").click(); await p.waitForTimeout(400);
await shot(p, "b3-date-picker");
const dlg = p.getByRole("dialog", { name: "Choose exam date" });
console.log((await dlg.innerText()).slice(0, 600));

await dlg.getByRole("button", { name: "Next month" }).click(); await p.waitForTimeout(200);
await dlg.getByRole("button", { name: "Next month" }).click(); await p.waitForTimeout(300);
await shot(p, "b4-date-dec");
await dlg.getByRole("button", { name: "14", exact: true }).click(); await p.waitForTimeout(200);
if (await dlg.isVisible()) await dlg.getByRole("button", { name: "Done" }).click(); await p.waitForTimeout(300);
await shot(p, "b5-filled");
await p.getByRole("button", { name: "Add", exact: true }).click(); await p.waitForTimeout(600);
await shot(p, "b6-one-exam");
// Custom exam
await p.getByRole("button", { name: "Add exam" }).click(); await p.waitForTimeout(400);
await p.getByRole("button", { name: /Which exam|PANCE/ }).first().click(); await p.waitForTimeout(300);
await p.getByRole("option", { name: "Custom…" }).click(); await p.waitForTimeout(300);
await shot(p, "c1-custom-empty");
await p.getByLabel("Custom exam name").pressSequentially("Pharm final", { delay: 30 }); await p.waitForTimeout(200);
await shot(p, "c2-custom-typed");
await p.getByText("Choose exam date").click(); await p.waitForTimeout(300);
const dlg2 = p.getByRole("dialog", { name: "Choose exam date" });
await dlg2.getByRole("button", { name: "Next month" }).click(); await p.waitForTimeout(200);
await dlg2.getByRole("button", { name: "6", exact: true }).click(); await p.waitForTimeout(200);
if (await dlg2.isVisible()) await dlg2.getByRole("button", { name: "Done" }).click(); await p.waitForTimeout(300);
await shot(p, "c3-custom-filled");
await p.getByRole("button", { name: "Add", exact: true }).click(); await p.waitForTimeout(600);
await shot(p, "c4-two-exams");
await b.close();
