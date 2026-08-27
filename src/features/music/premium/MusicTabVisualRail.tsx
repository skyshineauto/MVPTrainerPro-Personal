import type { MusicLibraryVisualTab } from "./musicLibraryShaders";

const TABS: MusicLibraryVisualTab[] = [
  "songs",
  "artists",
  "albums",
  "playlists",
  "smart",
  "intelligence",
  "discover",
  "audition",
];

export function MusicTabVisualRail({
  activeTab,
  hoveredTab,
}: {
  activeTab: MusicLibraryVisualTab;
  hoveredTab: MusicLibraryVisualTab | null;
}) {
  return (
    <div className="mvpTabVisualRail" aria-hidden="true">
      {TABS.map((tab) => {
        const active = tab === activeTab;
        const hovered = tab === hoveredTab;
        return (
          <span
            key={tab}
            className={`mvpTabVisualPlate${active ? " is-active" : ""}${hovered ? " is-hovered" : ""}`}
          >
            <i className="mvpTabVisualPlateEdge" />
            <b className="mvpTabVisualPlateWarm" />
          </span>
        );
      })}
    </div>
  );
}
