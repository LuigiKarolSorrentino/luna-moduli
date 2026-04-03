// ================================================================
//  MODULO EDUCATIVO — StreamingCommunity per Sora / Luna (iOS)
//  Autore  : Luigi  |  Versione: 1.0.3
//  Fix     : searchBaseUrl punta all'API JSON, non alla pagina HTML
//            L'API /api/search?q= ritorna JSON direttamente
// ================================================================

// ↓↓↓ AGGIORNA IL DOMINIO QUI SE CAMBIA ↓↓↓
const BASE_URL = "https://streamingcommunityz.pink";
const CDN_URL  = "https://cdn.streamingcommunity.pink/images";
// ↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑↑


// ── UTILITÀ ─────────────────────────────────────────────────────

function decodeHTML(str) {
    if (!str) return "";
    return str
        .replace(/&amp;/g,  "&")
        .replace(/&lt;/g,   "<")
        .replace(/&gt;/g,   ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g,  "'")
        .replace(/&nbsp;/g, " ");
}

/**
 * extractInertiaData
 * Usato per extractDetails ed extractEpisodes.
 * Quelle pagine usano Inertia.js: i dati sono nel data-page
 * del <div id="app">.
 * La ricerca invece usa direttamente l'API JSON.
 */
function extractInertiaData(html) {
    const match = html.match(/id="app"[^>]*data-page="([^"]+)"/);
    if (!match) return null;
    try {
        return JSON.parse(decodeHTML(match[1]));
    } catch (e) {
        return null;
    }
}

function buildPosterUrl(images) {
    if (!images || images.length === 0) return "";
    const poster = images.find(img => img.type === "poster") || images[0];
    return poster ? `${CDN_URL}/${poster.filename}` : "";
}


// ================================================================
//  FUNZIONE 1 — searchResults(html)
//
//  searchBaseUrl nel JSON punta a:
//    BASE_URL/api/search?q=%s
//  Questa URL ritorna JSON puro (non HTML!), quindi il parametro
//  "html" contiene in realtà testo JSON.
//
//  Struttura risposta API:
//  { "data": [ {id, name, slug, type, images: [{type, filename}]} ] }
// ================================================================
async function searchResults(html) {
    const results = [];

    try {
        const data = JSON.parse(html);

        // DEBUG: logga la struttura raw della risposta API
        console.log("[SC DEBUG] Raw API response:", JSON.stringify(data).substring(0, 500));
        console.log("[SC DEBUG] Keys:", Object.keys(data));

        const titles = data.data || data.titles || data.results || data || [];
        console.log("[SC DEBUG] Titles array length:", Array.isArray(titles) ? titles.length : "NOT AN ARRAY");
        if (Array.isArray(titles) && titles.length > 0) {
            console.log("[SC DEBUG] First title keys:", Object.keys(titles[0]));
        }

        (Array.isArray(titles) ? titles : []).forEach(t => {
            if (!t.name || !t.id) return;
            results.push({
                title: t.name,
                image: buildPosterUrl(t.images),
                href:  `${BASE_URL}/titles/${t.id}-${t.slug || ""}`
            });
        });

    } catch (e) {
        console.log("[SC DEBUG] JSON parse failed, raw html:", html.substring(0, 300));
    }

    return JSON.stringify(results);
}


// ================================================================
//  FUNZIONE 2 — extractDetails(html)
//  Pagina titolo: usa Inertia.js → data-page attribute
//  Output: JSON.stringify([{description, aliases, airdate}])
// ================================================================
async function extractDetails(html) {
    const details = [];

    try {
        const pageData = extractInertiaData(html);

        if (pageData?.props?.title) {
            const t = pageData.props.title;
            details.push({
                description: t.plot || t.overview || "Nessuna descrizione.",
                aliases:     (t.original_name && t.original_name !== t.name)
                                 ? t.original_name : "N/A",
                airdate:     t.release_date
                                 ? t.release_date.substring(0, 4)
                                 : (t.start_date || "N/A")
            });
        }

        // Fallback regex
        if (details.length === 0) {
            const desc = html.match(/<div[^>]*class="[^"]*overview[^"]*"[^>]*>([\s\S]*?)<\/div>/);
            const year = html.match(/<span[^>]*class="[^"]*year[^"]*"[^>]*>(\d{4})<\/span>/);
            details.push({
                description: desc ? decodeHTML(desc[1].replace(/<[^>]+>/g, "").trim()) : "N/A",
                aliases: "N/A",
                airdate: year ? year[1] : "N/A"
            });
        }
    } catch (e) {}

    return JSON.stringify(details);
}


// ================================================================
//  FUNZIONE 3 — extractEpisodes(html)
//  Nota: per le serie Inertia serve header X-Inertia.
//  Con asyncJS:true facciamo una fetch con gli header corretti.
//  Output: JSON.stringify([{href, number}])
// ================================================================
async function extractEpisodes(html) {
    const episodes = [];

    try {
        const pageData = extractInertiaData(html);

        if (pageData?.props) {
            const { title, loadedSeason, episodes: rawEps } = pageData.props;

            // Film: un solo "episodio" fittizio
            if (title?.type === "movie") {
                return JSON.stringify([{
                    href:   `${BASE_URL}/watch/${title.id}?e=1`,
                    number: "1"
                }]);
            }

            // Serie: episodi della stagione corrente
            const eps = loadedSeason?.episodes || rawEps || [];

            // Se non ci sono episodi, prova a caricare la stagione via API Inertia
            if (eps.length === 0 && title?.id && title?.slug) {
                try {
                    const versionMatch = html.match(/"version"\s*:\s*"([^"]+)"/);
                    const version = versionMatch ? versionMatch[1] : "";
                    const resp = await fetch(
                        `${BASE_URL}/titles/${title.id}-${title.slug}/stagione-1`,
                        {
                            headers: {
                                "X-Inertia": "true",
                                "X-Inertia-Version": version,
                                "Accept": "application/json"
                            }
                        }
                    );
                    const json = await resp.json();
                    const apiEps = json?.props?.loadedSeason?.episodes || [];
                    apiEps.forEach(ep => {
                        episodes.push({
                            href:   `${BASE_URL}/watch/${title.id}?e=${ep.id}`,
                            number: String(ep.number || "0")
                        });
                    });
                } catch (_) {}
            } else {
                eps.forEach(ep => {
                    episodes.push({
                        href:   `${BASE_URL}/watch/${title?.id}?e=${ep.id}`,
                        number: String(ep.number || ep.episode_number || "0")
                    });
                });
            }
        }

        if (episodes.length === 0) {
            const re = /href="(\/watch\/[^"]+)"[^>]*>[\s\S]*?Episodio\s*(\d+)/g;
            let m;
            while ((m = re.exec(html)) !== null)
                episodes.push({ href: BASE_URL + m[1], number: m[2] });
        }

        episodes.sort((a, b) => parseInt(a.number) - parseInt(b.number));
    } catch (e) {}

    return JSON.stringify(episodes);
}


// ================================================================
//  FUNZIONE 4 — extractStreamUrl(html)
//  Output: stringa URL (.m3u8 HLS o .mp4)
// ================================================================
async function extractStreamUrl(html) {
    try {
        const iframeMatch = html.match(/src="(https:\/\/vixcloud\.co\/embed\/[^"]+)"/);

        if (iframeMatch) {
            try {
                const playerHtml = await (await fetch(iframeMatch[1])).text();
                const m3u8 = playerHtml.match(/['"]?(https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/);
                if (m3u8) return m3u8[1];
            } catch (_) {
                return iframeMatch[1];
            }
        }

        const hls = html.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/);
        if (hls) return hls[1];

        const mp4 = html.match(/['"]([^'"]+\.mp4[^'"]*)['"]/);
        if (mp4) return mp4[1];
    } catch (e) {}

    return null;
