import { notFound } from "next/navigation";
import WorkshopDetail from "./WorkshopDetail";
import { loadPublicWorkshops } from "@/lib/community/publicWorkshops";

export const dynamic = "force-dynamic";

export default async function Page({ params }) {
  const { slug } = await params;
  const { workshops, error } = await loadPublicWorkshops();
  if (error) return <WorkshopDetail workshops={[]} loadError={error} />;
  if (!workshops.some((item) => item.slug === slug)) notFound();
  return <WorkshopDetail workshops={workshops} />;
}
