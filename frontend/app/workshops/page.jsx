import WorkshopsList from "./WorkshopsList";
import { loadPublicWorkshops } from "@/lib/community/publicWorkshops";

export const dynamic = "force-dynamic";

export default async function Page() {
  const { workshops, error } = await loadPublicWorkshops();
  return <WorkshopsList workshops={workshops} loadError={error} />;
}
