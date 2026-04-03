// ================================================================
//  MODULO EDUCATIVO — StreamingCommunity per Sora / Luna (iOS)
//  Autore  : Luigi
//  Versione: 1.0.0
//  Scopo   : Dimostrare il funzionamento dei moduli Sora/Luna:
//            parsing HTML, JSON embedded (Inertia.js), regex, fetch
// ================================================================
//
//  COME FUNZIONA UN MODULO SORA (sintesi):
//  ┌──────────────────────────────────────────────────────────┐
//  │  Sora scarica l'HTML di un URL e lo passa alla funzione  │
//  │  JS corrispondente. Il JS analizza l'HTML e restituisce  │
//  │  i dati in un formato JSON prestabilito.                 │
//  └──────────────────────────────────────────────────────────┘
//
//  Le 4 funzioni obbligatorie (asyncJS: true → possono usare await/fetch):
//  1. searchResults(html)   → [{title, image, href}]
//  2. extractDetails(html)  → [{description, aliases, airdate}]
//  3. extractEpisodes(html) → [{href, number}]
//  4. extractStreamUrl(html)→ "url_stringa"
//
//  NOTA: Aggiorna BASE_URL con il dominio attivo del sito.
//        Il dominio di StreamingCommunity cambia periodicamente.
// ================================================================


// ── COSTANTI ────────────────────────────────────────────────────
const BASE_URL = "https://streamingcommunity.pink"; // ← aggiorna qui
const CDN_URL  = "https://cdn.streamingcommunity.pink/images";


// ── UTILITÀ INTERNE ─────────────────────────────────────────────

/**
 * decodeHTML
 * Converte le entità HTML in caratteri normali.
 * Necessario perché i valori negli attributi HTML sono encodati.
 * Esempio: "&amp;" → "&"  |  "&#39;" → "'"  |  "&lt;" → "<"
 */
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
 * StreamingCommunity è costruito con Laravel + Inertia.js + Vue.
 * Inertia inserisce TUTTI i dati della pagina come JSON nell'attributo
 * data-page del tag <div id="app">. Questo evita richieste API separate.
 *
 * Struttura HTML tipica:
 *   <div id="app" data-page="{&quot;component&quot;:&quot;Titles/...&quot;,...}">
 *
 * Struttura JSON estratto (semplificata):
 *   {
 *     "component": "Titles/Index",
 *     "props": {
 *       "titles": { "data": [{id, name, slug, images, ...}] },
 *       "title":  { id, name, plot, release_date, type, ... }
 *     }
 *   }
 */
function extractInertiaData(html) {
    // Cerca il div#app e cattura il valore di data-page
    const match = html.match(/id="app"[^>]*data-page="([^"]+)"/);
    if (!match) return null;

    try {
        // 1. decodeHTML: converte entità HTML (es. &quot; → ")
        // 2. JSON.parse: trasforma la stringa in un oggetto JS
        return JSON.parse(decodeHTML(match[1]));
    } catch (e) {
        // Se il parsing fallisce (JSON malformato) restituiamo null
        return null;
    }
}

/**
 * buildPosterUrl
 * Costruisce l'URL completo dell'immagine poster da un array images[].
 * StreamingCommunity memorizza le immagini sul proprio CDN
 * con il path: CDN_URL/{filename}
 * Il campo "type" distingue: "poster", "backdrop", "logo", ecc.
 */
function buildPosterUrl(images) {
    if (!images || images.length === 0) return "";
    // Preferiamo il poster verticale; fallback sulla prima immagine disponibile
    const poster = images.find(img => img.type === "poster") || images[0];
    return poster ? `${CDN_URL}/${poster.filename}` : "";
}


// ================================================================
//  FUNZIONE 1 — searchResults(html)
// ================================================================
//  Viene chiamata quando l'utente cerca un titolo.
//  Sora costruisce l'URL: searchBaseUrl (con %s = query utente)
//  es. "https://streamingcommunity.foo/search?q=inception"
//  scarica l'HTML e lo passa qui.
//
//  Output atteso: Array di oggetti { title, image, href }
// ================================================================
async function searchResults(html) {
    const results = [];

    // ── METODO PRINCIPALE: dati Inertia.js ──────────────────────
    const pageData = extractInertiaData(html);

    if (pageData?.props?.titles) {
        // I titoli sono in props.titles.data[] (paginazione Laravel)
        // oppure direttamente in props.titles[] (versioni più vecchie)
        const titlesArray = Array.isArray(pageData.props.titles)
            ? pageData.props.titles
            : (pageData.props.titles.data || []);

        titlesArray.forEach(title => {
            const name  = title.name || title.original_name || "";
            const id    = title.id;
            const slug  = title.slug || "";

            if (!name || !id) return; // salta voci incomplete

            results.push({
                title: name,
                image: buildPosterUrl(title.images),
                // URL canonical del titolo sul sito
                href:  `${BASE_URL}/titles/${id}-${slug}`
            });
        });
    }

    // ── FALLBACK: regex sull'HTML (per versioni senza Inertia) ───
    // Utile se il sito aggiorna la propria struttura
    if (results.length === 0) {
        /*
         * Pattern HTML cercato:
         *   <a href="/titles/123-inception" ...>
         *     <img src="https://cdn.../poster.jpg" ...>
         *     <span class="title-name">Inception</span>
         *   </a>
         */
        const cardRegex =
            /href="(\/titles\/[^"]+)"[^>]*>[\s\S]*?<img[^>]+src="([^"]*)"[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/g;
        let m;
        while ((m = cardRegex.exec(html)) !== null) {
            results.push({
                href:  BASE_URL + m[1],
                image: m[2],
                title: decodeHTML(m[3].trim())
            });
        }
    }

    return results;
}


// ================================================================
//  FUNZIONE 2 — extractDetails(html)
// ================================================================
//  Chiamata sulla pagina del singolo titolo: /titles/{id}-{slug}
//  Deve restituire informazioni descrittive sul contenuto.
//
//  Output atteso: Array con un oggetto { description, aliases, airdate }
//  (Sora si aspetta un array anche se contiene un solo elemento)
// ================================================================
async function extractDetails(html) {
    const details = [];

    // ── METODO PRINCIPALE: dati Inertia.js ──────────────────────
    const pageData = extractInertiaData(html);

    if (pageData?.props?.title) {
        const t = pageData.props.title;

        // "plot" nelle versioni recenti, "overview" nelle precedenti
        const description = t.plot || t.overview || "Nessuna descrizione disponibile.";

        // Il titolo originale (es. "The Dark Knight" invece di "Il Cavaliere Oscuro")
        const aliases = t.original_name && t.original_name !== t.name
            ? t.original_name
            : "N/A";

        // release_date ha formato ISO "YYYY-MM-DD" → prendiamo solo l'anno
        const airdate = t.release_date
            ? t.release_date.substring(0, 4)
            : (t.start_date || "N/A");

        details.push({ description, aliases, airdate });
    }

    // ── FALLBACK: parsing HTML ───────────────────────────────────
    if (details.length === 0) {
        const descMatch = html.match(
            /<div[^>]*class="[^"]*overview[^"]*"[^>]*>([\s\S]*?)<\/div>/
        );
        const yearMatch = html.match(
            /<span[^>]*class="[^"]*year[^"]*"[^>]*>(\d{4})<\/span>/
        );

        const description = descMatch
            ? decodeHTML(descMatch[1].replace(/<[^>]+>/g, "").trim())
            : "N/A";
        const airdate = yearMatch ? yearMatch[1] : "N/A";

        details.push({ description, aliases: "N/A", airdate });
    }

    return details;
}


// ================================================================
//  FUNZIONE 3 — extractEpisodes(html)
// ================================================================
//  Per i FILM: restituisce un solo elemento (il film stesso).
//  Per le SERIE: restituisce tutti gli episodi della stagione.
//
//  StreamingCommunity mostra una stagione alla volta.
//  Sora chiama questa funzione per ogni stagione tramite href.
//
//  Output atteso: Array di oggetti { href, number }
// ================================================================
async function extractEpisodes(html) {
    const episodes = [];

    // ── METODO PRINCIPALE: dati Inertia.js ──────────────────────
    const pageData = extractInertiaData(html);

    if (pageData?.props) {
        const props = pageData.props;
        const title = props.title;

        // ── CASO FILM ────────────────────────────────────────────
        // I film non hanno episodi: Sora ha bisogno comunque di
        // un href per sapere dove trovare lo stream. Usiamo l'URL
        // della pagina di visione con e=1 come episodio fittizio.
        if (title?.type === "movie") {
            episodes.push({
                href:   `${BASE_URL}/watch/${title.id}?e=1`,
                number: "1"
            });
            return episodes;
        }

        // ── CASO SERIE ───────────────────────────────────────────
        // props.loadedSeason contiene la stagione correntemente visualizzata
        // con il suo array di episodi
        const eps = props.loadedSeason?.episodes
                 || props.episodes
                 || [];

        eps.forEach(ep => {
            const num  = String(ep.number || ep.episode_number || "0");
            // URL di visione: /watch/{titleId}?e={episodeId}
            // ep.id è l'ID univoco dell'episodio nel database del sito
            const href = `${BASE_URL}/watch/${title?.id}?e=${ep.id}`;
            episodes.push({ href, number: num });
        });
    }

    // ── FALLBACK: regex sull'HTML ────────────────────────────────
    if (episodes.length === 0) {
        const epRegex =
            /href="(\/watch\/[^"]+)"[^>]*>[\s\S]*?Episodio\s*(\d+)/g;
        let m;
        while ((m = epRegex.exec(html)) !== null) {
            episodes.push({ href: BASE_URL + m[1], number: m[2] });
        }
    }

    // Ordine crescente (ep. 1, 2, 3 ...)
    episodes.sort((a, b) => parseInt(a.number) - parseInt(b.number));

    return episodes;
}


// ================================================================
//  FUNZIONE 4 — extractStreamUrl(html)
// ================================================================
//  Chiamata sulla pagina /watch/{titleId}?e={episodeId}
//  Deve restituire l'URL diretto del video (m3u8 HLS o mp4).
//
//  StreamingCommunity usa il player Vixcloud (vixcloud.co).
//  La pagina /watch/ contiene un <iframe> che punta a Vixcloud.
//  Vixcloud a sua volta espone un manifest .m3u8 via HLS.
//
//  Output atteso: Stringa URL
// ================================================================
async function extractStreamUrl(html) {

    // ── STEP 1: Cerca l'URL dell'iframe Vixcloud nella pagina ────
    // Struttura HTML tipica:
    //   <iframe src="https://vixcloud.co/embed/123?token=abc&..."></iframe>
    const iframeMatch = html.match(
        /src="(https:\/\/vixcloud\.co\/embed\/[^"]+)"/
    );

    if (iframeMatch) {
        const embedUrl = iframeMatch[1];

        // ── STEP 2 (asyncJS): Carica la pagina del player ────────
        // Grazie ad asyncJS:true possiamo fare una fetch aggiuntiva.
        // La pagina del player Vixcloud contiene il manifest .m3u8
        // in una variabile JS: window.masterPlaylist = "https://..."
        try {
            const resp       = await fetch(embedUrl);
            const playerHtml = await resp.text();

            // Cerca il manifest HLS nella variabile JS del player
            const m3u8Match = playerHtml.match(
                /['"]?(https?:\/\/[^'"]+\.m3u8[^'"]*)['"]/
            );
            if (m3u8Match) return m3u8Match[1];

            // Fallback: cerca qualsiasi .m3u8 nella risposta
            const genericM3u8 = playerHtml.match(/https?:\/\/[^\s"']+\.m3u8/);
            if (genericM3u8) return genericM3u8[0];

        } catch (fetchError) {
            // fetch fallita (es. CORS) → restituiamo l'embed come fallback
            // Sora potrebbe riuscire a gestirlo direttamente
            return embedUrl;
        }
    }

    // ── FALLBACK A: .m3u8 diretto nella pagina ───────────────────
    const hlsMatch = html.match(/['"]([^'"]+\.m3u8[^'"]*)['"]/);
    if (hlsMatch) return hlsMatch[1];

    // ── FALLBACK B: file mp4 ─────────────────────────────────────
    const mp4Match = html.match(/['"]([^'"]+\.mp4[^'"]*)['"]/);
    if (mp4Match) return mp4Match[1];
      
    // Nessuno stream trovato
    return null;
}
