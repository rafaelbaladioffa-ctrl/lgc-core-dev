import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { sitesMapApi } from "../api/resources";
import type { SiteMapData, SiteMapPoint } from "../api/types";
import Icon from "../components/ui/Icon";
import PageHeader from "../components/ui/PageHeader";
import StatCard from "../components/ui/StatCard";
import { useAuth } from "../context/AuthContext";
import { usePageText } from "../i18n";
import { PERMS, hasPerm } from "../utils/permissions";

const TEXT = {
  "pt-BR": {
    back: "Voltar para Cadastros",
    eyebrow: "Sites", title: "Mapa de Sites",
    subtitle: "Sites ativos com coordenadas e seus projetos em andamento.",
    reprocess: "Reprocessar geocodificação", processing: "Processando...",
    sitesOnMap: "Sites no mapa", withoutCoords: "Sem coordenadas",
    withoutCoordsHint: "ativos, ainda não geocodificados",
    loading: "Carregando...",
    activeProjects: (n: number) => `${n} projeto(s) ativo(s) neste site`,
    noProjects: "Nenhum projeto ativo neste site no momento.",
    popupActiveProjects: (n: number) => `${n} projeto(s) ativo(s)`,
    confirmRegeocode: "Reprocessar a geocodificação de todos os sites ativos sem coordenadas manuais? Isso pode levar alguns segundos.",
    regeocodeResult: (updated: number, failed: number, skipped: number) => {
      let msg = `${updated} site(s) geocodificado(s) com sucesso.`;
      if (failed) msg += ` ${failed} não foram encontrados pelo serviço de geocodificação.`;
      if (skipped) msg += ` ${skipped} ignorado(s) por ter coordenadas manuais.`;
      return msg;
    },
  },
  "en-US": {
    back: "Back to Registrations",
    eyebrow: "Sites", title: "Sites Map",
    subtitle: "Active sites with coordinates and their ongoing projects.",
    reprocess: "Reprocess geocoding", processing: "Processing...",
    sitesOnMap: "Sites on map", withoutCoords: "Without coordinates",
    withoutCoordsHint: "active, not yet geocoded",
    loading: "Loading...",
    activeProjects: (n: number) => `${n} active project(s) at this site`,
    noProjects: "No active projects at this site right now.",
    popupActiveProjects: (n: number) => `${n} active project(s)`,
    confirmRegeocode: "Reprocess geocoding for all active sites without manual coordinates? This may take a few seconds.",
    regeocodeResult: (updated: number, failed: number, skipped: number) => {
      let msg = `${updated} site(s) geocoded successfully.`;
      if (failed) msg += ` ${failed} could not be found by the geocoding service.`;
      if (skipped) msg += ` ${skipped} skipped (manual coordinates).`;
      return msg;
    },
  },
  "es-ES": {
    back: "Volver a Registros",
    eyebrow: "Sitios", title: "Mapa de Sitios",
    subtitle: "Sitios activos con coordenadas y sus proyectos en curso.",
    reprocess: "Reprocesar geocodificación", processing: "Procesando...",
    sitesOnMap: "Sitios en mapa", withoutCoords: "Sin coordenadas",
    withoutCoordsHint: "activos, aún no geocodificados",
    loading: "Cargando...",
    activeProjects: (n: number) => `${n} proyecto(s) activo(s) en este sitio`,
    noProjects: "Sin proyectos activos en este sitio en este momento.",
    popupActiveProjects: (n: number) => `${n} proyecto(s) activo(s)`,
    confirmRegeocode: "¿Reprocesar la geocodificación de todos los sitios activos sin coordenadas manuales? Esto puede tardar algunos segundos.",
    regeocodeResult: (updated: number, failed: number, skipped: number) => {
      let msg = `${updated} sitio(s) geocodificado(s) con éxito.`;
      if (failed) msg += ` ${failed} no fueron encontrados por el servicio de geocodificación.`;
      if (skipped) msg += ` ${skipped} ignorado(s) por tener coordenadas manuales.`;
      return msg;
    },
  },
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function pinIcon(count: number): L.DivIcon {
  const hasProjects = count > 0;
  return L.divIcon({
    className: "",
    html: `
      <div style="position:relative;width:30px;height:30px;">
        <div style="width:30px;height:30px;border-radius:50%;background:${hasProjects ? "#F16023" : "#172033"};border:3px solid #fff;box-shadow:0 1px 5px rgba(0,0,0,0.35);"></div>
        <div style="position:absolute;top:-7px;right:-7px;min-width:19px;height:19px;border-radius:999px;background:${hasProjects ? "#F16023" : "#172033"};color:#fff;border:2px solid #fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 3px;">${count}</div>
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -18],
  });
}

export default function SitesMap() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const p = usePageText(TEXT);
  const canRegeocode = hasPerm(user, PERMS.changeSite);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const [data, setData] = useState<SiteMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [regeocoding, setRegeocoding] = useState(false);
  const [selectedPoint, setSelectedPoint] = useState<SiteMapPoint | null>(null);

  function reload() {
    setLoading(true);
    sitesMapApi.mapData().then(setData).finally(() => setLoading(false));
  }

  useEffect(() => {
    reload();
  }, []);

  useEffect(() => {
    if (!data || !mapContainerRef.current) return;

    if (!mapRef.current) {
      mapRef.current = L.map(mapContainerRef.current).setView([-15.78, -47.93], 4);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19,
      }).addTo(mapRef.current);
    }

    const map = mapRef.current;
    const layerGroup = L.layerGroup().addTo(map);

    data.points.forEach((point) => {
      const count = point.projects.length;
      const marker = L.marker([point.lat, point.lng], { icon: pinIcon(count) }).addTo(layerGroup);
      const popupHtml = `
        <strong>${escapeHtml(point.name)}</strong>
        <span style="background:#F16023;color:#fff;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700;margin-left:6px;">${p.popupActiveProjects(count)}</span><br/>
        ${point.client ? `<span style="color:#526174;">${escapeHtml(point.client)}</span><br/>` : ""}
        <span style="color:#526174;font-size:12px;">${escapeHtml(point.address)}</span>
      `;
      marker.bindPopup(popupHtml);
      marker.on("click", () => setSelectedPoint(point));
    });

    map.invalidateSize();
    if (data.points.length) {
      const bounds = L.latLngBounds(data.points.map((p) => [p.lat, p.lng] as [number, number]));
      map.fitBounds(bounds, { padding: [32, 32] });
      if (data.points.length === 1) map.setZoom(14);
    }

    return () => {
      layerGroup.remove();
    };
  }, [data]);

  useEffect(() => {
    if (!mapRef.current) return;
    setTimeout(() => mapRef.current?.invalidateSize(), 210);
  }, [selectedPoint]);

  useEffect(() => {
    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  async function handleRegeocodeAll() {
    if (!confirm(p.confirmRegeocode)) return;
    setRegeocoding(true);
    try {
      const result = await sitesMapApi.regeocodeBulk();
      alert(p.regeocodeResult(result.updated, result.failed, result.skipped_manual));
      reload();
    } finally {
      setRegeocoding(false);
    }
  }

  return (
    <div>
      <Link to="/cadastros" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-muted)", textDecoration: "none", fontSize: 13, marginBottom: 12 }}>
        <Icon name="arrow_back" style={{ fontSize: 16 }} />
        {p.back}
      </Link>

      <PageHeader
        eyebrow={p.eyebrow}
        title={p.title}
        subtitle={p.subtitle}
        actions={
          canRegeocode ? (
            <button className="btn btn-outline" onClick={handleRegeocodeAll} disabled={regeocoding}>
              <Icon name="my_location" style={{ fontSize: 16 }} />
              {regeocoding ? p.processing : p.reprocess}
            </button>
          ) : undefined
        }
      />

      {data && (
        <div className="stat-grid">
          <StatCard label={p.sitesOnMap} value={data.points_count} />
          <StatCard label={p.withoutCoords} value={data.without_coords} hint={p.withoutCoordsHint} />
        </div>
      )}

      {loading && !data && <p style={{ color: "var(--text-muted)" }}>{p.loading}</p>}

      <div className="card" style={{ padding: 0, overflow: "hidden", position: "relative", height: "calc(100vh - 300px)", minHeight: 480 }}>
        <div ref={mapContainerRef} style={{ height: "100%", width: "100%" }} />

        {selectedPoint && (
          <div
            className="site-map-panel"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              width: 320,
              maxWidth: "100%",
              background: "#fff",
              borderLeft: "1px solid #DDE3EA",
              boxShadow: "-4px 0 12px rgba(0,0,0,0.06)",
              overflowY: "auto",
              zIndex: 1000,
            }}
          >
            <div style={{ padding: "16px 18px", borderBottom: "1px solid #DDE3EA", display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div>
                <h2 style={{ fontSize: 15, color: "#172033", margin: "0 0 4px" }}>{selectedPoint.name}</h2>
                <p style={{ fontSize: 12, color: "#526174", margin: 0 }}>
                  {p.activeProjects(selectedPoint.projects.length)}
                </p>
              </div>
              <button
                onClick={() => setSelectedPoint(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#526174", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>
            <div>
              {selectedPoint.projects.length === 0 ? (
                <div style={{ padding: 18, fontSize: 13, color: "#526174" }}>{p.noProjects}</div>
              ) : (
                selectedPoint.projects.map((project) => (
                  <a
                    key={project.id}
                    onClick={(e) => {
                      e.preventDefault();
                      navigate(`/projetos/${project.id}`);
                    }}
                    href={`/projetos/${project.id}`}
                    style={{ display: "block", padding: "12px 18px", borderBottom: "1px solid #F0F2F5", textDecoration: "none", cursor: "pointer" }}
                  >
                    <div style={{ fontSize: 11, color: "#F16023", fontWeight: 700 }}>{project.code}</div>
                    <div style={{ fontSize: 13.5, color: "#172033", fontWeight: 600, margin: "2px 0" }}>{project.name}</div>
                    {project.client && <div style={{ fontSize: 12, color: "#526174" }}>{project.client}</div>}
                  </a>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
