import { notFound } from "next/navigation";
import { requireWorkshopsAdmin } from "../gate";
import { listHostOptions, loadWorkshop } from "../data";
import WorkshopForm from "../WorkshopForm";

export const metadata = {
  title: "Edit workshop — RPS Cohorts",
  robots: { index: false, follow: false, nocache: true },
};

export default async function EditWorkshopPage({ params }) {
  const { id } = await params;
  const user = await requireWorkshopsAdmin(`/admin/workshops/${id}`);
  const [workshop, hosts] = await Promise.all([loadWorkshop(id), listHostOptions()]);
  if (!workshop) notFound();
  return <WorkshopForm key={id} viewer={user.email} workshopId={id} initial={workshop} hosts={hosts} />;
}
