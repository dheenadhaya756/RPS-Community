import { requireWorkshopsAdmin } from "./gate";
import { listWorkshops } from "./data";
import WorkshopsClient from "./WorkshopsClient";

export const metadata = {
  title: "Workshops — RPS Cohorts",
  robots: { index: false, follow: false, nocache: true },
};

export default async function WorkshopsPage() {
  const user = await requireWorkshopsAdmin("/admin/workshops");
  const { rows, error } = await listWorkshops();
  return <WorkshopsClient viewer={user.email} workshops={rows} loadError={error} />;
}
