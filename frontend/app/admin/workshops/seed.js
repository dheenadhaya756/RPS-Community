export function emptyWorkshop() {
  return {
    id: "",
    slug: "",
    status: "draft",
    cohortLabel: "",
    title: "",
    summary: "",
    pitch: "",
    description: [""],
    whoItsFor: [""],
    curriculumTitle: "What’s in it for you?",
    curriculum: [""],
    dateTime: "",
    durationMins: 120,
    bannerUrl: "",
    emailBannerUrl: "",
    hostIds: [],
    meetLink: "",
    dialNumber: "",
    dialPin: "",
    recordingUrl: "",
    notesTitle: "",
    notesDescription: "",
    notesFileName: "",
    notesFileUrl: "",
    notesPages: "",
    notesSize: "",
    recap: [""],
    testimonials: [],
  };
}

export function slugify(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}
