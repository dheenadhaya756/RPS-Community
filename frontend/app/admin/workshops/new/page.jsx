import { requireWorkshopsAdmin } from "../gate";
import { listHostOptions } from "../data";
import { emptyWorkshop } from "../seed";
import WorkshopForm from "../WorkshopForm";

export const metadata = {
  title: "New workshop — RPS Cohorts",
  robots: { index: false, follow: false, nocache: true },
};

export default async function NewWorkshopPage() {
  const user = await requireWorkshopsAdmin("/admin/workshops/new");
  const hosts = await listHostOptions();
  return <WorkshopForm key="new" viewer={user.email} workshopId="new" initial={emptyWorkshop()} hosts={hosts} />;
}
