# October 7 catalog source repair

The refresh stopped because reviewed Veeam articles changed. This repair records the changed source text, updates the affected advisories and coverage policy together, and regenerates the catalog through the existing live validation gates.

| Source | Change and approach |
| --- | --- |
| [KB4902](https://www.veeam.com/kb4902) | Add CVE-2026-58069 for an authenticated Cloud Connect tenant reading files on a Windows service provider host. Apply the documented version 12 and 13 boundaries and branch-specific fixes. Preserve the existing CVE-2026-58070 credential rotation and retained-log mitigation. Agent for Windows CVEs remain outside the catalog's supported product scope. |
| [KB4934](https://www.veeam.com/kb4934) | Add CVE-2025-64393 and CVE-2026-93026 to VBR, and CVE-2025-64392 to Enterprise Manager. All affect version 12 through 12.3.2.4854; 12.3.2.4934 fixes them and version 13 is unaffected. Mentioning an Enterprise Manager key in CVE-2026-93026 does not make it an Enterprise Manager server vulnerability: the documented affected product and storage location are VBR. |
| [KB3103](https://www.veeam.com/kb3103) and [KB3108](https://www.veeam.com/kb3108) | Accept the corresponding inventory updates. Dedicated advisories own the new in-scope findings; Agent inventory entries do not create unsupported product findings. |
| [KB4858](https://www.veeam.com/kb4858) | Accept the Veeam ONE Reporter scanner clarification. Existing CVEs and fixed builds are unchanged. No independent component-version check is added to the public tool. |
| [KB2053](https://www.veeam.com/kb2053) and [KB4738](https://www.veeam.com/kb4738) | The newly listed 13.1 to 13.1.1 route exposed a precedence bug. Preserve the specific same-family Updater instructions when the generic KB2053 route describes the same direct target. Other reviewed routes remain intact. |

Validation includes the live security coverage gates, affected/fixed build boundaries, separation of VBR and Enterprise Manager findings, mitigation preservation, route precedence and retention of other reviewed routes, all adapter suites, app tests, lint, catalog validation, and the production build. A repeat live check encountered a transient KB3144 fetch failure and correctly retained the accepted catalog; this did not authorize bypassing the source gate.

The PR diff contains the exact accepted before/after source text in the baseline file, alongside advisory policy and catalog changes. Review those together. A reviewer should verify the product/build relationships and exclusions against the linked Veeam sources, rather than treating this brief or passing tests as independent evidence. Ordinary feedback on the repair is sufficient to request a different approach.
