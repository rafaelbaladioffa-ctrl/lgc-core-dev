import { useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useTabs } from "../context/TabsContext";
import { useI18n } from "../i18n";
import Icon from "./ui/Icon";

export default function TabBar() {
  const { tabs, closeTab, reorderTabs } = useTabs();
  const { t } = useI18n();
  const location = useLocation();
  const navigate = useNavigate();
  const dragId = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  if (tabs.length === 0) return null;

  const currentPath = location.pathname + location.search;

  return (
    <div className="global-tab-bar">
      {tabs.map((tab) => {
        const active = tab.path === currentPath;
        const isDragOver = dragOverId === tab.id && dragId.current !== tab.id;
        return (
          <div
            key={tab.id}
            className={`gtab${active ? " gtab-active" : ""}${isDragOver ? " gtab-dragover" : ""}`}
            draggable
            onClick={() => navigate(tab.path)}
            title={tab.label}
            onDragStart={(e) => {
              dragId.current = tab.id;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (dragId.current !== tab.id) setDragOverId(tab.id);
            }}
            onDragLeave={() => setDragOverId(null)}
            onDrop={(e) => {
              e.preventDefault();
              if (dragId.current && dragId.current !== tab.id) {
                reorderTabs(dragId.current, tab.id);
              }
              dragId.current = null;
              setDragOverId(null);
            }}
            onDragEnd={() => {
              dragId.current = null;
              setDragOverId(null);
            }}
          >
            <Icon name={tab.icon} style={{ fontSize: 14 }} />
            <span className="gtab-label">{tab.label}</span>
            <button
              className="gtab-close"
              aria-label={t.common.fecharAba}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
                if (active && tabs.length > 1) {
                  const idx = tabs.findIndex((t) => t.id === tab.id);
                  const next = tabs[idx - 1] || tabs[idx + 1];
                  if (next) navigate(next.path);
                }
              }}
            >
              <Icon name="close" style={{ fontSize: 12 }} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
