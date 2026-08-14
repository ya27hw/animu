/**
 * ANIMU Control Panel — Web UI Application Core
 * Dual-Shell Support:
 *   - Dark Horizon HUD (Design 1)
 *   - Light Editorial Slate Workstation (Design 2)
 */

(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    // CommonJS / Node environment
    module.exports = factory();
  } else {
    // Browser environment
    root.AnimuApp = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // SVG Placeholder for offline / broken image handling
  const SVG_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 300' width='200' height='300' fill='%23111827'%3E%3Crect width='200' height='300' fill='%231e293b'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%2364748b' font-family='sans-serif' font-size='14'%3EANIMU%3C/text%3E%3C/svg%3E";

  // Real current AniList season (WINTER Jan-Mar, SPRING Apr-Jun, SUMMER Jul-Sep, FALL Oct-Dec)
  function getCurrentSeason() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1; // 1-12
    if (month >= 1 && month <= 3) return { season: 'WINTER', year };
    if (month >= 4 && month <= 6) return { season: 'SPRING', year };
    if (month >= 7 && month <= 9) return { season: 'SUMMER', year };
    return { season: 'FALL', year };
  }

  // Curated Fallback Data (Instantly ready & verified across all 9 viewports)
  const FALLBACK_DATA = {
    trending: [
      {"id": 180136, "title": {"romaji": "Tsuihou Sareta Tensei Juukishi wa Game Chishiki de Musou Suru", "english": "The Exiled Heavy Knight Knows How to Game the System"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx180136-gtMTCRlOD4OE.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": 26, "popularity": 52303, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571307}},
      {"id": 208044, "title": {"romaji": "Rakudai Kenja no Gakuin Musou: Nidome no Tensei, S-Rank Cheat Majutsushi Bouken-roku", "english": "From Overshadowed to Overpowered: Second Reincarnation of a Talentless Sage"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx208044-Pm2UhvApQFUh.jpg"}, "averageScore": 65, "format": "ONA", "seasonYear": 2026, "episodes": null, "popularity": 43451, "nextAiringEpisode": {"episode": 9, "timeUntilAiring": 569747}},
      {"id": 196187, "title": {"romaji": "Super no Ura de Yani Suu Futari", "english": "Smoking Behind the Supermarket with You"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx196187-0dgFi2CPp3xn.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 104986, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 569507}},
      {"id": 207141, "title": {"romaji": "Yani Neko", "english": "Chainsmoker Cat"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx207141-h5q5KJPd6vaX.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 63173, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571547}},
      {"id": 204466, "title": {"romaji": "Otome Kaijuu Caraméliser", "english": "KAIJU GIRL CARAMELISE"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx204466-vXMvIs4VOoQd.png"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 33743, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 575027}},
      {"id": 189046, "title": {"romaji": "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season", "english": "Re:ZERO -Starting Life in Another World- Season 4"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2026, "episodes": 19, "popularity": 128853, "nextAiringEpisode": {"episode": 13, "timeUntilAiring": 476147}},
      {"id": 21, "title": {"romaji": "ONE PIECE", "english": "ONE PIECE"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg"}, "averageScore": 87, "format": "TV", "seasonYear": 1999, "episodes": null, "popularity": 740734, "nextAiringEpisode": {"episode": 1174, "timeUntilAiring": 221507}},
      {"id": 269, "title": {"romaji": "BLEACH", "english": "Bleach"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx269-d2GmRkJbMopq.png"}, "averageScore": 79, "format": "TV", "seasonYear": 2004, "episodes": 366, "popularity": 511065, "nextAiringEpisode": null},
      {"id": 135865, "title": {"romaji": "Youjo Senki II", "english": "Saga of Tanya the Evil Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx135865-T7XIPMAbqcxN.png"}, "averageScore": 81, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 86695, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 474347}},
      {"id": 178789, "title": {"romaji": "Mushoku Tensei III: Isekai Ittara Honki Dasu", "english": "Mushoku Tensei: Jobless Reincarnation Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2026, "episodes": 14, "popularity": 141893, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 224147}},
      {"id": 194829, "title": {"romaji": "Katainaka no Ossan, Kensei ni Naru II", "english": "From Old Country Bumpkin to Master Swordsman II"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx194829-bZKwhfo60EuF.jpg"}, "averageScore": 71, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 38848, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 482507}},
      {"id": 198946, "title": {"romaji": "Clevatess II: Majuu no Ou to Itsuwari no Yuusha Denshou", "english": "Clevatess Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx198946-IGXmbqBEYRYD.jpg"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 39464, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 472547}}
    ],
    popular: [
      {"id": 16498, "title": {"romaji": "Shingeki no Kyojin", "english": "Attack on Titan"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx16498-buvcRTBx4NSm.jpg"}, "averageScore": 85, "format": "TV", "seasonYear": 2013, "episodes": 25, "popularity": 1042021, "nextAiringEpisode": null},
      {"id": 101922, "title": {"romaji": "Kimetsu no Yaiba", "english": "Demon Slayer: Kimetsu no Yaiba"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx101922-WBsBl0ClmgYL.jpg"}, "averageScore": 83, "format": "TV", "seasonYear": 2019, "episodes": 26, "popularity": 983384, "nextAiringEpisode": null},
      {"id": 113415, "title": {"romaji": "Jujutsu Kaisen", "english": "JUJUTSU KAISEN"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx113415-LHBAeoZDIsnF.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2020, "episodes": 24, "popularity": 959669, "nextAiringEpisode": null},
      {"id": 1535, "title": {"romaji": "DEATH NOTE", "english": "Death Note"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx1535-kUgkcrfOrkUM.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2006, "episodes": 37, "popularity": 950182, "nextAiringEpisode": null},
      {"id": 21459, "title": {"romaji": "Boku no Hero Academia", "english": "My Hero Academia"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21459-nYh85uj2Fuwr.jpg"}, "averageScore": 77, "format": "TV", "seasonYear": 2016, "episodes": 13, "popularity": 865236, "nextAiringEpisode": null},
      {"id": 11061, "title": {"romaji": "HUNTER×HUNTER (2011)", "english": "Hunter x Hunter (2011)"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx11061-y5gsT1hoHuHw.png"}, "averageScore": 89, "format": "TV", "seasonYear": 2011, "episodes": 148, "popularity": 831771, "nextAiringEpisode": null},
      {"id": 21087, "title": {"romaji": "One Punch Man", "english": "One-Punch Man"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21087-B5DHjqZ3kW4b.jpg"}, "averageScore": 83, "format": "TV", "seasonYear": 2015, "episodes": 12, "popularity": 760237, "nextAiringEpisode": null},
      {"id": 21, "title": {"romaji": "ONE PIECE", "english": "ONE PIECE"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21-ELSYx3yMPcKM.jpg"}, "averageScore": 87, "format": "TV", "seasonYear": 1999, "episodes": null, "popularity": 740734, "nextAiringEpisode": {"episode": 1174, "timeUntilAiring": 221507}},
      {"id": 20605, "title": {"romaji": "Tokyo Ghoul", "english": "Tokyo Ghoul"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/b20605-k665mVkSug8D.jpg"}, "averageScore": 76, "format": "TV", "seasonYear": 2014, "episodes": 12, "popularity": 732495, "nextAiringEpisode": null},
      {"id": 20958, "title": {"romaji": "Shingeki no Kyojin Season 2", "english": "Attack on Titan Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20958-HuFJyr54Mmir.jpg"}, "averageScore": 85, "format": "TV", "seasonYear": 2017, "episodes": 12, "popularity": 726244, "nextAiringEpisode": null},
      {"id": 5114, "title": {"romaji": "Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST", "english": "Fullmetal Alchemist: Brotherhood"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx5114-nSWCgQlmOMtj.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2009, "episodes": 64, "popularity": 720687, "nextAiringEpisode": null},
      {"id": 20, "title": {"romaji": "NARUTO", "english": "Naruto"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20-dE6UHbFFg1A5.jpg"}, "averageScore": 80, "format": "TV", "seasonYear": 2002, "episodes": 220, "popularity": 717326, "nextAiringEpisode": null}
    ],
    top: [
      {"id": 154587, "title": {"romaji": "Sousou no Frieren", "english": "Frieren: Beyond Journey’s End"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx154587-qQTzQnEJJ3oB.jpg"}, "averageScore": 91, "format": "TV", "seasonYear": 2023, "episodes": 28, "popularity": 469820},
      {"id": 114129, "title": {"romaji": "Gintama: THE FINAL", "english": "Gintama: THE VERY FINAL"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx114129-RLgSuh6YbeYx.jpg"}, "averageScore": 91, "format": "MOVIE", "seasonYear": 2021, "episodes": 1, "popularity": 54896},
      {"id": 20996, "title": {"romaji": "Gintama°", "english": "Gintama Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx20996-kBEGEGdeK1r7.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2015, "episodes": 51, "popularity": 118705},
      {"id": 171627, "title": {"romaji": "Chainsaw Man: Reze-hen", "english": "Chainsaw Man – The Movie: Reze Arc"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx171627-ZN9D7P46yHnw.png"}, "averageScore": 90, "format": "MOVIE", "seasonYear": 2025, "episodes": 1, "popularity": 229156},
      {"id": 5114, "title": {"romaji": "Hagane no Renkinjutsushi: FULLMETAL ALCHEMIST", "english": "Fullmetal Alchemist: Brotherhood"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx5114-nSWCgQlmOMtj.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2009, "episodes": 64, "popularity": 720687},
      {"id": 189046, "title": {"romaji": "Re:Zero kara Hajimeru Isekai Seikatsu 4th Season", "english": "Re:ZERO -Starting Life in Another World- Season 4"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx189046-yaHWtS5FII46.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2026, "episodes": 19, "popularity": 128853},
      {"id": 182469, "title": {"romaji": "ONE PIECE FAN LETTER", "english": "ONE PIECE FAN LETTER"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx182469-JQ808NBPxmgn.jpg"}, "averageScore": 90, "format": "SPECIAL", "seasonYear": 2024, "episodes": 1, "popularity": 56925},
      {"id": 104578, "title": {"romaji": "Shingeki no Kyojin Season 3 Part 2", "english": "Attack on Titan Season 3 Part 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx104578-k61nx3LPjvgd.jpg"}, "averageScore": 90, "format": "TV", "seasonYear": 2019, "episodes": 10, "popularity": 604685},
      {"id": 124194, "title": {"romaji": "Fruits Basket: The Final", "english": "Fruits Basket The Final Season"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx124194-TJlqMMR7BGn9.jpg"}, "averageScore": 89, "format": "TV", "seasonYear": 2021, "episodes": 13, "popularity": 175242},
      {"id": 11061, "title": {"romaji": "HUNTER×HUNTER (2011)", "english": "Hunter x Hunter (2011)"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx11061-y5gsT1hoHuHw.png"}, "averageScore": 89, "format": "TV", "seasonYear": 2011, "episodes": 148, "popularity": 831771},
      {"id": 9253, "title": {"romaji": "Steins;Gate", "english": "Steins;Gate"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx9253-tIUXF2gfU8Sg.jpg"}, "averageScore": 89, "format": "TV", "seasonYear": 2011, "episodes": 24, "popularity": 588392},
      {"id": 21745, "title": {"romaji": "Owarimonogatari (Ge)", "english": "Owarimonogatari Second Season"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx21745-VrhhJjZNdBXV.png"}, "averageScore": 89, "format": "TV", "seasonYear": 2017, "episodes": 7, "popularity": 122916}
    ],
    seasonal: [
      {"id": 178789, "title": {"romaji": "Mushoku Tensei III: Isekai Ittara Honki Dasu", "english": "Mushoku Tensei: Jobless Reincarnation Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2026, "episodes": 14, "popularity": 141893, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 224147}},
      {"id": 196187, "title": {"romaji": "Super no Ura de Yani Suu Futari", "english": "Smoking Behind the Supermarket with You"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx196187-0dgFi2CPp3xn.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 104986, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 569507}},
      {"id": 135865, "title": {"romaji": "Youjo Senki II", "english": "Saga of Tanya the Evil Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx135865-T7XIPMAbqcxN.png"}, "averageScore": 81, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 86695, "nextAiringEpisode": {"episode": 7, "timeUntilAiring": 474347}},
      {"id": 185874, "title": {"romaji": "BLEACH: Sennen Kessen-hen - Kashin-tan", "english": "BLEACH: Thousand-Year Blood War - The Calamity"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx185874-aU3e6tBT6wwA.jpg"}, "averageScore": 88, "format": "TV", "seasonYear": 2026, "episodes": 10, "popularity": 71608, "nextAiringEpisode": {"episode": 6, "timeUntilAiring": 312000}},
      {"id": 207141, "title": {"romaji": "Yani Neko", "english": "Chainsmoker Cat"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx207141-h5q5KJPd6vaX.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 63173, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571547}},
      {"id": 187538, "title": {"romaji": "BLACK TORCH", "english": "BLACK TORCH"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187538-fXVXKYUA3VV6.jpg"}, "averageScore": 71, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 58842, "nextAiringEpisode": {"episode": 5, "timeUntilAiring": 198000}},
      {"id": 180136, "title": {"romaji": "Tsuihou Sareta Tensei Juukishi wa Game Chishiki de Musou Suru", "english": "The Exiled Heavy Knight Knows How to Game the System"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx180136-gtMTCRlOD4OE.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": 26, "popularity": 52303, "nextAiringEpisode": {"episode": 8, "timeUntilAiring": 571307}},
      {"id": 210031, "title": {"romaji": "Seihantai na Kimi to Boku 2nd Season", "english": "You and I Are Polar Opposites Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx210031-TppgcHZh46LY.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 51397, "nextAiringEpisode": {"episode": 6, "timeUntilAiring": 412000}},
      {"id": 103303, "title": {"romaji": "Nijusseiki Denki Mokuroku: Eureka Evrika", "english": "Sparks of Tomorrow"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx103303-IF43hFJPPv2Y.png"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 50212, "nextAiringEpisode": null},
      {"id": 187260, "title": {"romaji": "Kimi ga Shinu made Koi wo Shitai", "english": "I Want to Love You Till Your Dying Day"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187260-WW5RBa5NINRP.jpg"}, "averageScore": 74, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 49349, "nextAiringEpisode": null},
      {"id": 177699, "title": {"romaji": "Koukaku Kidoutai: THE GHOST IN THE SHELL", "english": "THE GHOST IN THE SHELL"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx177699-hnzc1CS5ZSM2.png"}, "averageScore": 76, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 47762, "nextAiringEpisode": null},
      {"id": 133007, "title": {"romaji": "Mahou Shoujo Madoka☆Magica: Walpurgis no Kaiten", "english": "Puella Magi Madoka Magica the Movie -Walpurgisnacht: Rising-"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx133007-5gOUXDvzxy9S.jpg"}, "averageScore": 88, "format": "MOVIE", "seasonYear": 2026, "episodes": 1, "popularity": 47685, "nextAiringEpisode": null}
    ],
    upcoming: [
      {"id": 133007, "title": {"romaji": "Mahou Shoujo Madoka☆Magica: Walpurgis no Kaiten", "english": "Puella Magi Madoka Magica the Movie -Walpurgisnacht: Rising-"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx133007-5gOUXDvzxy9S.jpg"}, "averageScore": 88, "format": "MOVIE", "seasonYear": 2026, "episodes": 1, "popularity": 47685},
      {"id": 177699, "title": {"romaji": "Koukaku Kidoutai: THE GHOST IN THE SHELL", "english": "THE GHOST IN THE SHELL"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx177699-hnzc1CS5ZSM2.png"}, "averageScore": 76, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 47762},
      {"id": 187538, "title": {"romaji": "BLACK TORCH", "english": "BLACK TORCH"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187538-fXVXKYUA3VV6.jpg"}, "averageScore": 71, "format": "TV", "seasonYear": 2026, "episodes": null, "popularity": 58842},
      {"id": 103303, "title": {"romaji": "Nijusseiki Denki Mokuroku: Eureka Evrika", "english": "Sparks of Tomorrow"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx103303-IF43hFJPPv2Y.png"}, "averageScore": 75, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 50212},
      {"id": 187260, "title": {"romaji": "Kimi ga Shinu made Koi wo Shitai", "english": "I Want to Love You Till Your Dying Day"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx187260-WW5RBa5NINRP.jpg"}, "averageScore": 74, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 49349},
      {"id": 159309, "title": {"romaji": "Otomege Sekai wa Mob ni Kibishii Sekai desu 2", "english": "Trapped in a Dating Sim: The World of Otome Games is Tough for Mobs Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx159309-wRfh9O1odrDJ.jpg"}, "averageScore": 67, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 47120},
      {"id": 185542, "title": {"romaji": "Gaikotsu Kishi-sama, Tadaima Isekai e Odekakechuu II", "english": "Skeleton Knight in Another World Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx185542-6a9LCWlLHa0T.jpg"}, "averageScore": 66, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 43831},
      {"id": 178789, "title": {"romaji": "Mushoku Tensei III: Isekai Ittara Honki Dasu", "english": "Mushoku Tensei: Jobless Reincarnation Season 3"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx178789-hNXjKFzUq7mk.jpg"}, "averageScore": 84, "format": "TV", "seasonYear": 2026, "episodes": 14, "popularity": 141893},
      {"id": 196187, "title": {"romaji": "Super no Ura de Yani Suu Futari", "english": "Smoking Behind the Supermarket with You"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx196187-0dgFi2CPp3xn.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 104986},
      {"id": 135865, "title": {"romaji": "Youjo Senki II", "english": "Saga of Tanya the Evil Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx135865-T7XIPMAbqcxN.png"}, "averageScore": 81, "format": "TV", "seasonYear": 2026, "episodes": 12, "popularity": 86695},
      {"id": 185874, "title": {"romaji": "BLEACH: Sennen Kessen-hen - Kashin-tan", "english": "BLEACH: Thousand-Year Blood War - The Calamity"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx185874-aU3e6tBT6wwA.jpg"}, "averageScore": 88, "format": "TV", "seasonYear": 2026, "episodes": 10, "popularity": 71608},
      {"id": 210031, "title": {"romaji": "Seihantai na Kimi to Boku 2nd Season", "english": "You and I Are Polar Opposites Season 2"}, "coverImage": {"large": "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx210031-TppgcHZh46LY.jpg"}, "averageScore": 82, "format": "TV", "seasonYear": 2026, "episodes": 13, "popularity": 51397}
    ]
  };

  const initialSeasonInfo = getCurrentSeason();

  // Application State
  const state = {
    activeTab: 'discover',
    theme: typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') || 'light') : 'light',
    userName: '',
    userId: null,
    titleLang: typeof localStorage !== 'undefined' ? (localStorage.getItem('titleLanguage') || 'romaji') : 'romaji',
    titleLanguage: typeof localStorage !== 'undefined' ? (localStorage.getItem('titleLanguage') || 'romaji') : 'romaji',
    config: {},
    animeList: [],
    animeListLoaded: false,
    listEntriesByMedia: {},
    activeMediaDetail: null,
    activeMediaDetailId: null,
    // Discover State
    discoverFeedKey: 'trending',
    discoverFormatFilter: 'ALL',
    discoverSearchTerm: '',
    discoverSeason: initialSeasonInfo.season,
    discoverSeasonYear: initialSeasonInfo.year,
    discoverChartTab: 'Airing',
    hideOnMyList: false,
    discoverFeeds: {
      trending: [...FALLBACK_DATA.trending],
      popular: [...FALLBACK_DATA.popular],
      top: [...FALLBACK_DATA.top],
      seasonal: [...FALLBACK_DATA.seasonal],
      upcoming: [...FALLBACK_DATA.upcoming]
    },
    airingRadar: [],
    discoverFeedCache: {},
    seasonalChart: [],
    spotlightMedia: null,
    // Lists state
    listsMediaType: 'ANIME',
    listsStatusGroup: 'ALL',
    listsViewMode: 'grid',
    listsSearch: '',
    listsSort: 'score',
    userListsData: null,
    // Search state
    searchQuery: '',
    searchEntity: 'ANIME',
    searchResults: [],
    searchPage: 1,
    searchHasNext: false,
    searchFilters: {},
    // Social state
    socialTab: 'feed',
    socialActivities: [],
    // Notifications
    notifications: [],
    unreadNotifications: 0
  };

  // Cached DOM elements
  const DOM = {
    // Shell & Navigation
    navTabs: typeof document !== 'undefined' ? document.querySelectorAll('.nav-tab') : [],
    mobileNavTabs: typeof document !== 'undefined' ? document.querySelectorAll('.mobile-nav-tab') : [],
    viewPanels: typeof document !== 'undefined' ? document.querySelectorAll('.view-panel') : [],
    themeToggles: typeof document !== 'undefined' ? document.querySelectorAll('.theme-toggle-btn') : [],
    // Modals
    mediaDetailModal: typeof document !== 'undefined' ? document.getElementById('media-detail-modal') : null,
    mediaDetailContent: typeof document !== 'undefined' ? document.getElementById('media-detail-content') : null,
    listEditorModal: typeof document !== 'undefined' ? document.getElementById('list-editor-modal') : null,
    settingsDialog: typeof document !== 'undefined' ? document.getElementById('settings-dialog') : null,
    nyaaDialog: typeof document !== 'undefined' ? document.getElementById('nyaa-dialog') : null,
    toastWrapper: typeof document !== 'undefined' ? document.getElementById('toast-wrapper') : null
  };

  let tabToken = 0;
  let seasonalCache = {};
  let seasonalChartInitialized = false;
  let seasonalObserver = null;
  let discoverSearchTimer = null;
  const DISCOVER_CACHE_TTL = 90 * 1000;
  let anilistQueue = Promise.resolve();

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function isStaleTab(token) {
    return token !== tabToken;
  }

  // ==============================================================
  // SECURITY: ESCAPING & SANITIZATION HELPERS (B1, N5)
  // ==============================================================
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[char]));
  }

  function sanitizeHtml(str) {
    if (!str) return '';
    const stripped = String(str).replace(/<[^>]*>?/gm, '');
    return escapeHtml(stripped);
  }

  // Helper: Format Time Duration
  function formatRelativeTime(seconds) {
    if (seconds <= 0 || seconds === undefined || seconds === null) return 'Aired';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `in ${d}d ${h}h`;
    if (h > 0) return `in ${h}h ${m}m`;
    return `in ${m}m`;
  }

  function formatCountdown(seconds) {
    if (seconds === undefined || seconds === null) return 'TBA';
    const value = Number(seconds);
    if (!Number.isFinite(value) || value <= 0) return 'Aired';
    const d = Math.floor(value / 86400);
    const h = Math.floor((value % 86400) / 3600);
    const m = Math.floor((value % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${Math.max(1, m)}m`;
  }

  function getAnimeTitle(media) {
    if (!media) return 'Untitled';
    if (typeof media === 'string') return media;
    const pref = state.titleLang || state.titleLanguage || 'romaji';
    if (media.title) {
      if (pref === 'english' && media.title.english) return media.title.english;
      if (pref === 'native' && media.title.native) return media.title.native;
      return media.title.userPreferred || media.title.romaji || media.title.english || media.title.native || 'Untitled';
    }
    return media.name || 'Untitled';
  }

  function formatTitle(titleObj) {
    if (!titleObj) return 'Untitled';
    if (typeof titleObj === 'string') return titleObj;
    return getAnimeTitle({ title: titleObj });
  }

  function getCoverImage(media, size = 'extraLarge') {
    if (!media) return SVG_PLACEHOLDER;
    if (media.coverImage) {
      const order = size === 'medium'
        ? ['medium', 'large', 'extraLarge']
        : ['extraLarge', 'large', 'medium'];
      return order.map(key => media.coverImage[key]).find(Boolean) || SVG_PLACEHOLDER;
    }
    if (media.image) return media.image;
    return SVG_PLACEHOLDER;
  }

  function isMediaOnList(media) {
    if (!media) return false;
    const id = Number(media.id || media.mediaId);
    return Boolean(media.inList || media.mediaListEntry || state.listEntriesByMedia[id] ||
      state.animeList.some(entry => Number(entry.mediaId || entry.id) === id));
  }

  function renderInListBadge(media, extraClass = '') {
    return isMediaOnList(media)
      ? `<span class="in-list-badge ${extraClass}">✓ In List</span>`
      : '';
  }

  // Toast HTML representation (escaped)
  function showToastHtml(message, type = 'info') {
    const icon = type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-info-circle';
    return `
      <div class="flex items-center gap-2.5">
        <i class="fa-solid ${icon}"></i>
        <span>${escapeHtml(message)}</span>
      </div>
      <button class="text-white/60 hover:text-white toast-close-btn cursor-pointer" type="button"><i class="fa-solid fa-xmark"></i></button>
    `;
  }

  // Toast Notification System (N5: Escaped message)
  function showToast(message, type = 'info') {
    if (typeof document === 'undefined') return;
    const wrapper = document.getElementById('toast-wrapper');
    if (!wrapper) return;
    const toast = document.createElement('div');
    const bgClass = type === 'error'
      ? 'bg-rose-600 text-white shadow-rose-900/40'
      : type === 'success'
      ? 'bg-emerald-600 text-white shadow-emerald-900/40'
      : 'bg-slate-900 dark:bg-[#151f33] text-white border border-cyan-500/30 shadow-cyan-950/40';
    
    toast.className = `pointer-events-auto px-4 py-3 rounded-2xl shadow-xl flex items-center justify-between gap-3 text-xs font-semibold transform transition-all duration-300 translate-y-4 opacity-0 ${bgClass}`;
    toast.innerHTML = showToastHtml(message, type);

    const closeBtn = toast.querySelector('.toast-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => toast.remove());
    }

    wrapper.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.remove('translate-y-4', 'opacity-0');
    });
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-2');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ==============================================================
  // ANILIST GRAPHQL DIRECT API WRAPPER (N1: Queued + Retried)
  // ==============================================================
  async function queryAniList(query, variables = {}) {
    const run = async () => {
      const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      };
      if (state.config && state.config.bearerTokenAnilist) {
        headers['Authorization'] = `Bearer ${state.config.bearerTokenAnilist}`;
      }

      let retryCount = 0;
      while (true) {
        let res;
        try {
          res = await fetch('https://graphql.anilist.co', {
            method: 'POST',
            headers,
            body: JSON.stringify({ query, variables })
          });
        } catch (fetchErr) {
          // AniList rate-limit responses (429) arrive WITHOUT the CORS
          // Access-Control-Allow-Origin header, so the browser blocks them
          // before JS ever sees the status — surfacing as a TypeError here.
          // Retry those network/CORS-level failures with backoff too.
          if (retryCount < 2) {
            const backoffSeconds = 2 * (2 ** retryCount);
            retryCount += 1;
            await sleep(backoffSeconds * 1000);
            continue;
          }
          throw new Error(fetchErr.message || 'AniList GraphQL request failed');
        }

        if (res.ok) {
          const json = await res.json();
          if (json.data && (!json.errors || json.errors.length === 0)) {
            return json.data;
          }
          throw new Error(json.errors?.[0]?.message || 'AniList GraphQL error');
        }

        if (res.status === 429 && retryCount < 2) {
          const retryAfterHeader = res.headers?.get?.('Retry-After');
          const retryAfter = Number.parseFloat(retryAfterHeader || '');
          const backoffSeconds = 2 * (2 ** retryCount);
          const waitSeconds = Number.isFinite(retryAfter) && retryAfter >= 0
            ? Math.max(retryAfter, backoffSeconds)
            : backoffSeconds;
          retryCount += 1;
          await sleep(waitSeconds * 1000);
          continue;
        }

        const err = await res.json().catch(() => ({}));
        throw new Error(err.errors?.[0]?.message || `AniList GraphQL HTTP ${res.status}`);
      }
    };

    // Promise.then(run, run) releases the queue after a rejected request.
    const result = anilistQueue.then(run, run);
    anilistQueue = result.catch(() => {});
    return result;
  }

  // API Client Interface
  const API = {
    queryAniList,

    async getDiscover(type) {
      try {
        const res = await fetch(`/api/anilist/discover?type=${encodeURIComponent(type || 'trending')}&perPage=12`);
        if (!res.ok) return { media: FALLBACK_DATA[type] || [] };
        return res.json();
      } catch (e) {
        return { media: FALLBACK_DATA[type] || [] };
      }
    },

    async getAiringToday(hours = 168) {
      try {
        const res = await fetch(`/api/anilist/airing-today?hours=${hours}`);
        if (!res.ok) return { entries: [] };
        return res.json();
      } catch (e) {
        return { entries: [] };
      }
    },

    async getAnimeList() {
      try {
        const res = await fetch('/api/anime');
        if (!res.ok) return [];
        return res.json();
      } catch (e) {
        return [];
      }
    },

    async getDownloads() {
      try {
        const res = await fetch('/api/downloads');
        if (!res.ok) return [];
        return res.json();
      } catch (e) {
        return [];
      }
    },

    async searchNyaa(mediaId, episode) {
      const payload = {};
      if (episode !== undefined) payload.episode = episode;
      const res = await fetch(`/api/anime/${mediaId}/nyaa-search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to query Nyaa index');
      return res.json();
    },

    async downloadNyaa(mediaId, link, episode) {
      const res = await fetch(`/api/anime/${mediaId}/nyaa-download`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ link, episode })
      });
      if (!res.ok) throw new Error('Failed to start torrent download');
      return res.json();
    },

    async getConfig() {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return {};
        return res.json();
      } catch (e) {
        return {};
      }
    },

    async saveConfig(payload) {
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error('Failed to save config');
      return res.json();
    },

    async getLogs(name = 'combined', lines = 250) {
      try {
        const res = await fetch(`/api/logs?name=${encodeURIComponent(name)}&lines=${lines}`);
        if (!res.ok) return { logs: '' };
        return res.json();
      } catch (e) {
        return { logs: '' };
      }
    },

    async getDownloadHistory() {
      try {
        const res = await fetch('/api/history');
        if (!res.ok) return [];
        return res.json();
      } catch (e) {
        return [];
      }
    },

    async clearHistory() {
      const res = await fetch('/api/history', { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to clear download history');
      return res.json();
    }
  };

  // Server-side List Entry Mutation Helper
  async function saveListEntryViaBackend(payload) {
    const res = await fetch('/api/anilist/list/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Failed to update list entry (HTTP ${res.status})`);
    return body;
  }

  // Quick Action: Add directly to watching list
  async function quickAddWatching(mediaId, title) {
    try {
      showToast(`Adding "${title || 'Anime'}" to Watching...`, 'info');
      await saveListEntryViaBackend({ mediaId: parseInt(mediaId, 10), status: 'CURRENT' });
      showToast(`Added "${title || 'Anime'}" to Watching list!`, 'success');
      state.listEntriesByMedia[mediaId] = {
        ...(state.listEntriesByMedia[mediaId] || {}),
        mediaId: parseInt(mediaId, 10),
        status: 'CURRENT'
      };
      if (state.activeTab === 'watching') loadWatching();
      if (state.activeTab === 'lists') loadUserListsData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // Quick Action: Open Nyaa Episode Search Modal
  async function quickNyaaSearch(mediaId, title) {
    openNyaaModal(mediaId, title);
  }

  // ==============================================================
  // HTML RENDER TEMPLATES (B1: Fully Escaped + Safe Delegated Hooks)
  // ==============================================================

  function renderDiscoverCardHtml(m) {
    if (!m) return '';
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m));
    const score = escapeHtml(m.averageScore ?? m.meanScore ?? '—');
    const format = escapeHtml(m.format || 'TV');
    const eps = escapeHtml(m.episodes ? `${m.episodes} eps` : 'Airing');
    const year = escapeHtml(m.seasonYear || '—');
    const nextAiring = m.nextAiringEpisode
      ? escapeHtml(`Ep ${m.nextAiringEpisode.episode} · ${formatCountdown(m.nextAiringEpisode.timeUntilAiring)}`)
      : '';
    const mediaId = Number(m.id) || 0;
    const inList = renderInListBadge(m, 'absolute bottom-2 right-2');

    return `
      <article class="group cursor-pointer bg-white dark:bg-[#0d1322] hover:bg-slate-50 dark:hover:bg-[#131b2e] border border-slate-200 dark:border-[#1c2742] hover:border-slate-300 dark:hover:border-cyan-500/40 rounded-2xl overflow-hidden transition-all duration-200 flex flex-col relative shadow-sm hover:shadow-md hover:-translate-y-0.5 min-w-0" data-action="open-detail" data-media-id="${mediaId}" title="${title}">
        <div class="relative aspect-[3/4.2] w-full overflow-hidden bg-slate-100 dark:bg-[#090d16]">
          <img src="${cover}" alt="${title}" loading="lazy" decoding="async" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
          <div class="absolute inset-0 bg-gradient-to-t from-slate-950/75 via-transparent to-transparent opacity-60 group-hover:opacity-35 transition-opacity"></div>
          <span class="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-white/90 dark:bg-slate-950/85 backdrop-blur-sm text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700 font-mono text-[10px] font-bold">${format}</span>
          <span class="absolute top-2 right-2 px-1.5 py-0.5 rounded-md bg-white/90 dark:bg-slate-950/85 backdrop-blur-sm text-amber-600 dark:text-amber-300 border border-amber-200 dark:border-amber-500/30 font-mono text-[10px] font-bold">★ ${score}%</span>
          ${nextAiring ? `<span class="absolute bottom-2 left-2 max-w-[calc(100%-5rem)] px-2 py-1 rounded-md bg-white/95 dark:bg-slate-950/90 text-slate-800 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700 text-[10px] font-mono truncate">${nextAiring}</span>` : ''}
          ${inList}
          <div class="absolute inset-0 bg-slate-950/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2" onclick="event.stopPropagation()">
            <button data-action="nyaa-search" data-media-id="${mediaId}" data-media-title="${title}" class="p-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 dark:bg-cyan-400 dark:hover:bg-cyan-300 dark:text-slate-950 text-white transition-all font-bold text-xs shadow-lg cursor-pointer" title="Search torrents"><i class="fa-solid fa-download"></i></button>
            <button data-action="open-detail" data-media-id="${mediaId}" class="p-2.5 rounded-xl bg-white dark:bg-slate-800 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-all text-xs shadow-lg cursor-pointer" title="Inspect media"><i class="fa-solid fa-eye"></i></button>
          </div>
        </div>
        <div class="p-3 flex flex-col gap-1 min-w-0">
          <h4 class="font-semibold text-xs sm:text-sm text-slate-900 dark:text-slate-100 line-clamp-2 leading-snug group-hover:text-rose-600 dark:group-hover:text-cyan-300 transition-colors" title="${title}">${title}</h4>
          <div class="flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono pt-0.5"><span>${eps}</span><span>${year}</span></div>
        </div>
      </article>
    `;
  }

  function renderAiringRadarItemHtml(item) {
    if (!item) return '';
    const raw = item.media || item;
    const m = raw.coverImage
      ? raw
      : { ...raw, id: raw.id || raw.mediaId, title: raw.title || { romaji: raw.romaji, english: raw.english }, coverImage: { medium: raw.coverImage } };
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m, 'medium'));
    const ep = escapeHtml(item.episode ?? m.nextAiringEpisode?.episode ?? '—');
    const seconds = item.timeUntilAiring ?? m.nextAiringEpisode?.timeUntilAiring;
    const countdown = escapeHtml(`Ep ${ep} · ${formatCountdown(seconds)}`);
    const mediaId = Number(m.id || item.mediaId) || 0;

    return `
      <article class="p-2.5 rounded-xl bg-slate-50 dark:bg-[#111827] hover:bg-white dark:hover:bg-[#18233a] border border-slate-200 dark:border-[#1c2742] hover:border-slate-300 dark:hover:border-cyan-500/40 transition-colors flex items-center gap-2.5 group cursor-pointer min-w-[190px] flex-shrink-0" data-action="open-detail" data-media-id="${mediaId}" title="${title}">
        <img src="${cover}" alt="${title}" loading="lazy" decoding="async" class="w-10 h-14 rounded-lg object-cover flex-shrink-0 bg-slate-100 dark:bg-[#090d16] border border-slate-200 dark:border-slate-700">
        <div class="flex flex-col min-w-0 gap-1">
          <span class="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-rose-600 dark:group-hover:text-cyan-300 transition-colors" title="${title}">${title}</span>
          ${renderInListBadge(m)}
          <span class="text-[10px] font-mono text-slate-500 dark:text-slate-400 whitespace-nowrap">${countdown}</span>
        </div>
      </article>
    `;
  }

  function renderSeasonalItemHtml(m) {
    if (!m) return '';
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m, 'medium'));
    const score = escapeHtml(m.averageScore ?? m.meanScore ?? '—');
    const format = escapeHtml(m.format || 'TV');
    const eps = escapeHtml(m.episodes ? `${m.episodes} eps` : 'TBA');
    const mediaId = Number(m.id) || 0;
    const airing = m.nextAiringEpisode
      ? escapeHtml(`Ep ${m.nextAiringEpisode.episode} · ${formatCountdown(m.nextAiringEpisode.timeUntilAiring)}`)
      : '';

    return `
      <article class="p-3 sm:p-3.5 rounded-xl bg-slate-50 dark:bg-[#111827] hover:bg-white dark:hover:bg-[#18233a] border border-slate-200 dark:border-[#1c2742] hover:border-slate-300 dark:hover:border-cyan-500/40 flex items-center justify-between gap-3 transition-colors group cursor-pointer min-w-0" data-action="open-detail" data-media-id="${mediaId}" title="${title}">
        <div class="flex items-center gap-3 min-w-0">
          <img src="${cover}" alt="${title}" loading="lazy" decoding="async" class="w-11 h-16 sm:w-12 sm:h-[4.5rem] rounded-lg object-cover flex-shrink-0 bg-slate-100 dark:bg-[#090d16] border border-slate-200 dark:border-slate-700">
          <div class="flex flex-col min-w-0 gap-1">
            <span class="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 truncate group-hover:text-rose-600 dark:group-hover:text-cyan-300 transition-colors" title="${title}">${title}</span>
            <span class="text-[11px] font-mono text-slate-500 dark:text-slate-400">${format} · ${eps}${airing ? ` · ${airing}` : ''}</span>
            ${renderInListBadge(m)}
          </div>
        </div>
        <span class="text-[11px] font-mono text-amber-600 dark:text-amber-300 font-bold whitespace-nowrap">★ ${score}%</span>
      </article>
    `;
  }

  function renderWatchingItemHtml(a) {
    const title = escapeHtml(a.name || a.title || 'Untitled');
    const cover = escapeHtml(a.image || a.coverImage || SVG_PLACEHOLDER);
    const ep = escapeHtml(a.episode || 0);
    const totalEp = escapeHtml(a.totalEpisodes || '?');
    const id = Number(a.id || a.mediaId) || 0;

    return `
      <div class="rounded-2xl border border-slate-200/60 dark:border-[#1c2742] bg-white dark:bg-[#0d1322] overflow-hidden shadow-sm hover:shadow-md transition-all flex flex-col justify-between">
        <div class="p-4 flex gap-4">
          <img src="${cover}" alt="${title}" class="w-16 h-24 rounded-xl object-cover flex-shrink-0 bg-slate-900 border border-slate-700/50">
          <div class="flex flex-col justify-between min-w-0">
            <div>
              <h3 class="font-bold text-sm text-slate-900 dark:text-white truncate cursor-pointer hover:text-cyan-400 transition-colors" data-action="open-detail" data-media-id="${id}" title="${title}">${title}</h3>
              <span class="text-xs font-mono text-slate-400">Progress: ${ep} / ${totalEp}</span>
            </div>
            <div class="flex items-center gap-2 pt-2">
              <button data-action="nyaa-search" data-media-id="${id}" data-media-title="${title}" class="px-3 py-1 bg-cyan-500/10 hover:bg-cyan-500 border border-cyan-500/20 text-cyan-400 hover:text-obsidian-950 font-semibold text-xs rounded-lg transition-colors cursor-pointer">
                <i class="fa-solid fa-download mr-1"></i>Torrents
              </button>
              <button data-action="open-list-editor" data-media-id="${id}" class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-white rounded-lg text-xs transition-colors cursor-pointer">
                <i class="fa-solid fa-pen"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderListEntryHtml(entry) {
    const m = entry.media || entry;
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m));
    const score = escapeHtml(entry.score || '—');
    const prog = escapeHtml(entry.progress || 0);
    const total = escapeHtml(m.episodes || '?');
    const id = Number(m.id || entry.mediaId) || 0;

    return `
      <div class="group cursor-pointer bg-[#0d1322] hover:bg-[#131b2e] hud-border rounded-xl overflow-hidden transition-all flex flex-col justify-between" data-action="open-detail" data-media-id="${id}">
        <div class="relative aspect-[3/4] bg-slate-900 overflow-hidden">
          <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
          <div class="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-amber-400 font-bold">★ ${score}</div>
          <div class="absolute bottom-1.5 left-1.5 right-1.5 px-1.5 py-0.5 rounded bg-black/80 font-mono text-[10px] text-cyan-300 truncate">${prog} / ${total} eps</div>
        </div>
        <div class="p-2">
          <h4 class="font-bold text-xs text-slate-200 line-clamp-1 group-hover:text-cyan-400" title="${title}">${title}</h4>
        </div>
      </div>
    `;
  }

  function renderSearchResultHtml(m) {
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m));
    const score = escapeHtml(m.averageScore || '—');
    const format = escapeHtml(m.format || 'TV');
    const id = Number(m.id) || 0;

    return `
      <div class="group cursor-pointer bg-[#0d1322] hover:bg-[#131b2e] hud-border rounded-xl overflow-hidden transition-all flex flex-col justify-between shadow-md" data-action="open-detail" data-media-id="${id}">
        <div class="relative aspect-[3/4] bg-[#090d16] overflow-hidden">
          <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
          <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-black/80 text-cyan-300 font-mono text-[10px] font-bold">${format}</div>
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-amber-400 font-mono text-[10px] font-bold">★ ${score}%</div>
        </div>
        <div class="p-2.5">
          <h4 class="font-bold text-xs text-slate-200 line-clamp-1 group-hover:text-cyan-400" title="${title}">${title}</h4>
        </div>
      </div>
    `;
  }

  function renderSocialActivityHtml(a) {
    const u = a.user || { name: 'User', avatar: { medium: SVG_PLACEHOLDER } };
    const userName = escapeHtml(u.name || 'User');
    const userAvatar = escapeHtml(u.avatar?.medium || SVG_PLACEHOLDER);
    const isList = Boolean(a.media);
    const text = isList
      ? `${escapeHtml(a.status || 'Updated')} ${a.progress ? `episode ${escapeHtml(a.progress)} of` : ''} ${escapeHtml(getAnimeTitle(a.media))}`
      : sanitizeHtml(a.text);

    return `
      <div class="p-4 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200/60 dark:border-slate-800 flex items-start gap-3.5">
        <img src="${userAvatar}" alt="${userName}" class="w-10 h-10 rounded-xl object-cover flex-shrink-0">
        <div class="flex-grow space-y-1 min-w-0">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-slate-900 dark:text-white">${userName}</span>
            <span class="text-[10px] font-mono text-slate-400">Activity</span>
          </div>
          <p class="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">${text}</p>
        </div>
      </div>
    `;
  }

  function renderHistoryItemHtml(h) {
    const title = escapeHtml(h.title || h.name || 'Episode Download');
    const time = escapeHtml(h.timestamp ? new Date(h.timestamp * 1000).toLocaleString() : 'Completed');

    return `
      <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
        <div class="flex items-center gap-3 min-w-0">
          <i class="fa-solid fa-cloud-arrow-down text-cyan-400 text-base"></i>
          <div class="flex flex-col min-w-0">
            <span class="font-bold text-slate-800 dark:text-slate-100 truncate" title="${title}">${title}</span>
            <span class="text-[10px] font-mono text-slate-400">${time}</span>
          </div>
        </div>
        <span class="px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono text-[10px] font-bold">COMPLETED</span>
      </div>
    `;
  }

  function renderNyaaCandidateHtml(c, mediaId) {
    const title = escapeHtml(c.title || c.name || 'Torrent Candidate');
    const size = escapeHtml(c.size || '');
    const seeders = escapeHtml(c.seeders !== undefined ? c.seeders : 0);
    const link = encodeURIComponent(c.link || c.magnet || '');
    const episode = Number(c.episode) || 1;

    return `
      <div class="p-3.5 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 text-xs">
        <div class="flex flex-col min-w-0">
          <span class="font-bold text-slate-800 dark:text-slate-100 truncate" title="${title}">${title}</span>
          <span class="text-[10px] font-mono text-slate-400">${size} • Seeders: ${seeders}</span>
        </div>
        <button data-action="download-torrent" data-media-id="${Number(mediaId) || 0}" data-torrent-link="${link}" data-episode="${episode}" class="px-3.5 py-1.5 bg-pink-500 hover:bg-pink-400 text-white rounded-xl font-bold shrink-0 transition-colors cursor-pointer">
          Download
        </button>
      </div>
    `;
  }

  // ==============================================================
  // THEME SWITCHER SYSTEM
  // ==============================================================
  function initTheme() {
    if (typeof document === 'undefined') return;
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'light';
    state.theme = saved;
    if (saved === 'light') {
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.classList.add('dark');
    }
  }

  function toggleTheme() {
    if (typeof document === 'undefined') return;
    const isDark = document.documentElement.classList.toggle('dark');
    state.theme = isDark ? 'dark' : 'light';
    if (typeof localStorage !== 'undefined') localStorage.setItem('theme', state.theme);
    if (state.activeTab === 'discover') {
      renderDiscover();
      renderAiringRadar();
      renderSeasonalChart();
    }
  }

  function switchTab(tabName) {
    if (!tabName || typeof document === 'undefined') return;
    state.activeTab = tabName;
    tabToken++;

    const activeNav = 'nav-tab px-3 py-1.5 rounded-lg text-xs font-bold text-slate-900 dark:text-slate-950 bg-slate-100 dark:bg-cyan-500 transition-all flex items-center gap-1.5 cursor-pointer';
    const idleNav = 'nav-tab px-3 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1.5 cursor-pointer';
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.className = btn.dataset.tab === tabName ? activeNav : idleNav;
    });

    document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
      const active = btn.dataset.tab === tabName;
      btn.className = active
        ? 'mobile-nav-tab flex items-center gap-2 px-2.5 py-2 text-xs font-bold rounded-lg text-rose-600 dark:text-cyan-300 bg-rose-50 dark:bg-cyan-500/10 cursor-pointer'
        : 'mobile-nav-tab flex items-center gap-2 px-2.5 py-2 text-xs font-semibold rounded-lg text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer';
    });

    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== tabName + '-panel');
    });
    document.getElementById('mobile-menu')?.classList.add('hidden');
    document.getElementById('hamburger-btn')?.setAttribute('aria-expanded', 'false');

    switch (tabName) {
      case 'discover': loadDiscover(); break;
      case 'watching': loadWatching(); break;
      case 'lists': loadUserListsData(); break;
      case 'search':
        if (state.searchResults.length === 0 && !state.searchQuery) performSearch();
        break;
      case 'social': loadSocialFeed(); break;
      case 'stats': loadUserStats(); break;
      case 'history': loadDownloadHistory(); break;
      case 'logs': loadLogs(); break;
      case 'settings': loadSettingsConfig(); break;
    }
  }

  function switchFeed(feedKey) {
    if (!['trending', 'popular', 'top', 'seasonal', 'upcoming'].includes(feedKey)) return;
    state.discoverFeedKey = feedKey;
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.discover-feed-tab').forEach(btn => {
        const active = btn.id === 'feed-tab-' + feedKey;
        btn.className = active
          ? 'discover-feed-tab px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer'
          : 'discover-feed-tab px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer';
      });
    }
    renderDiscover();
    fetchFeedData(feedKey);
  }

  function filterDiscoverFormat(format) {
    state.discoverFormatFilter = format || 'ALL';
    if (typeof document !== 'undefined') {
      const select = document.getElementById('format-filter');
      if (select) select.value = state.discoverFormatFilter;
    }
    renderDiscover();
  }

  // N1: Real Season Switcher Controller
  function setDiscoverSeason(season) {
    state.discoverSeason = season;
    if (typeof document !== 'undefined') {
      ['SPRING', 'SUMMER', 'FALL', 'WINTER'].forEach(value => {
        const button = document.getElementById('season-' + value);
        if (!button) return;
        button.className = value === season
          ? 'discover-season-btn py-1.5 px-3 rounded-lg text-xs font-bold bg-white dark:bg-cyan-500 text-slate-900 dark:text-slate-950 shadow-sm transition-all text-center cursor-pointer'
          : 'discover-season-btn py-1.5 px-3 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-all text-center cursor-pointer';
      });
      const yearTag = document.getElementById('seasonal-year-tag');
      if (yearTag) yearTag.textContent = state.discoverSeasonYear + ' ' + season;
    }
    if (seasonalChartInitialized) fetchSeasonalChartData();
    else renderSeasonalChart();
  }

  // N1 & N2: Subtab Switcher Controller (Airing, Upcoming, TBA, Archive)
  const SUBTAB_STATUS_MAP = {
    Airing: 'RELEASING',
    Upcoming: 'NOT_YET_RELEASED',
    TBA: 'NOT_YET_RELEASED',
    Archive: 'FINISHED'
  };

  function setDiscoverSubtab(subtab) {
    state.discoverChartTab = subtab;
    if (typeof document !== 'undefined') {
      ['Airing', 'Upcoming', 'TBA', 'Archive'].forEach(value => {
        const button = document.getElementById('subtab-' + value);
        if (!button) return;
        button.className = value === subtab
          ? 'discover-status-btn px-3 py-1.5 rounded-lg text-[11px] font-bold bg-slate-900 text-white dark:bg-cyan-500 dark:text-slate-950 flex-shrink-0 cursor-pointer'
          : 'discover-status-btn px-3 py-1.5 rounded-lg text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 flex-shrink-0 cursor-pointer';
      });
    }
    if (seasonalChartInitialized) fetchSeasonalChartData();
    else renderSeasonalChart();
  }

  // N3: Hide My List Toggle
  function toggleHideMyList(checked) {
    state.hideOnMyList = Boolean(checked);
    if (typeof document !== 'undefined') {
      const checkbox = document.getElementById('hide-my-list');
      if (checkbox) checkbox.checked = state.hideOnMyList;
    }
    renderSeasonalChart();
  }

  // Discover feed fetch with N4 stale-tab guard
  async function fetchFeedData(feedKey) {
    const cached = state.discoverFeedCache[feedKey];
    if (cached && Date.now() - cached.cachedAt < DISCOVER_CACHE_TTL) {
      state.discoverFeeds[feedKey] = cached.items;
      renderDiscover();
      return;
    }

    const token = tabToken;
    try {
      const res = await API.getDiscover(feedKey);
      if (isStaleTab(token)) return;
      const items = Array.isArray(res?.media) ? res.media.slice(0, 12) : [];
      if (items.length > 0) {
        state.discoverFeeds[feedKey] = items;
        state.discoverFeedCache[feedKey] = { items, cachedAt: Date.now() };
      }
    } catch (err) {
      // Keep the local seed visible when AniList is unavailable.
    }
    if (!isStaleTab(token) && state.activeTab === 'discover') renderDiscover();
  }

  // Airing strip fetch with N4 stale-tab guard
  async function fetchAiringRadarData() {
    const token = tabToken;
    try {
      const res = await API.getAiringToday(168);
      if (isStaleTab(token)) return;
      state.airingRadar = Array.isArray(res?.entries) ? res.entries : [];
    } catch (err) {
      state.airingRadar = [];
    }
    if (!isStaleTab(token) && state.activeTab === 'discover') renderAiringRadar();
  }

  // Seasonal Chart GraphQL Query (N1)
  const SEASONAL_CHART_QUERY = `
    query ($season: MediaSeason, $seasonYear: Int, $status: MediaStatus) {
      Page(page: 1, perPage: 30) {
        media(season: $season, seasonYear: $seasonYear, status: $status, type: ANIME, sort: POPULARITY_DESC, isAdult: false) {
          id
          title { romaji english native userPreferred }
          coverImage { extraLarge large medium color }
          averageScore
          meanScore
          episodes
          format
          status
          season
          seasonYear
          nextAiringEpisode { episode airingAt timeUntilAiring }
          mediaListEntry { id status progress }
        }
      }
    }
  `;

  // Seasonal Chart fetch with Direct GraphQL, caching & N4 stale-tab guard (N1, N2, N4)
  async function fetchSeasonalChartData() {
    if (!seasonalChartInitialized) return;
    const token = tabToken;
    const season = state.discoverSeason || 'SUMMER';
    const year = parseInt(state.discoverSeasonYear || 2026, 10);
    const subtab = state.discoverChartTab || 'Airing';
    const status = SUBTAB_STATUS_MAP[subtab] || 'RELEASING';
    const cacheKey = season + '_' + year + '_' + status;

    if (seasonalCache[cacheKey]) {
      state.seasonalChart = seasonalCache[cacheKey];
      renderSeasonalChart();
      return;
    }

    const chart = document.getElementById('seasonal-chart');
    if (chart) chart.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400 font-mono text-xs"><i class="fa-solid fa-spinner fa-spin text-xl text-rose-500 dark:text-cyan-400 mb-2"></i><p>Loading ${season} ${year} chart...</p></div>`;

    try {
      const data = await queryAniList(SEASONAL_CHART_QUERY, { season, seasonYear: year, status });
      if (isStaleTab(token)) return;
      const items = data?.Page?.media || [];
      seasonalCache[cacheKey] = items;
      if (state.discoverSeason === season && state.discoverChartTab === subtab) {
        state.seasonalChart = items;
        renderSeasonalChart();
      }
    } catch (err) {
      if (!isStaleTab(token)) renderSeasonalChart(err.message);
    }
  }

  async function ensureUserList() {
    if (state.animeListLoaded) return;
    const payload = await API.getAnimeList();
    const list = Array.isArray(payload) ? payload : (payload?.anime || []);
    state.animeList = list;
    list.forEach(entry => {
      const id = Number(entry.mediaId || entry.id);
      if (id) state.listEntriesByMedia[id] = { ...state.listEntriesByMedia[id], mediaId: id, status: 'CURRENT', progress: entry.progress || 0 };
    });
    state.animeListLoaded = true;
  }

  function setupSeasonalObserver() {
    if (typeof document === 'undefined') return;
    const section = document.getElementById('seasonal-chart-section');
    if (!section) return;
    const initialize = () => {
      if (seasonalChartInitialized) return;
      seasonalChartInitialized = true;
      seasonalObserver?.disconnect();
      fetchSeasonalChartData();
    };
    if ('IntersectionObserver' in window) {
      seasonalObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) initialize();
      }, { rootMargin: '240px 0px' });
      seasonalObserver.observe(section);
    } else {
      initialize();
    }
  }

  async function loadDiscover() {
    renderDiscover();
    renderAiringRadar();
    renderSeasonalChart();

    await Promise.allSettled([
      ensureUserList(),
      fetchFeedData(state.discoverFeedKey),
      fetchAiringRadarData()
    ]);
    if (state.activeTab === 'discover') {
      renderDiscover();
      renderAiringRadar();
    }
  }

  // Render Discover Hero Spotlight & Grid
  function renderDiscover() {
    if (typeof document === 'undefined') return;
    const feedKey = state.discoverFeedKey;
    let list = (state.discoverFeeds[feedKey] || FALLBACK_DATA[feedKey] || []).slice(0, 12);

    if (state.discoverFormatFilter !== 'ALL') {
      list = list.filter(m => m.format === state.discoverFormatFilter);
    }
    if (state.discoverSearchTerm) {
      list = list.filter(m => getAnimeTitle(m).toLowerCase().includes(state.discoverSearchTerm));
    }

    const feedNames = {
      trending: 'Trending now',
      popular: 'Most popular',
      top: 'Top rated',
      seasonal: 'Seasonal picks',
      upcoming: 'Coming soon'
    };
    ['trending', 'popular', 'top', 'seasonal', 'upcoming'].forEach(key => {
      const badge = document.getElementById('feed-badge-' + key);
      if (badge) badge.textContent = Math.min(12, (state.discoverFeeds[key] || FALLBACK_DATA[key] || []).length);
    });
    const count = document.getElementById('feed-count');
    if (count) count.textContent = list.length + ' items';
    const title = document.getElementById('feed-title');
    if (title) title.textContent = feedNames[feedKey] || 'Discover';
    const subtitle = document.getElementById('feed-subtitle');
    if (subtitle) subtitle.textContent = list.length + ' titles';

    const hero = document.getElementById('spotlight-hero');
    const heroMedia = list[0] || (state.discoverFeeds.trending || [])[0];
    if (heroMedia) {
      hero?.classList.remove('hidden');
      state.spotlightMedia = heroMedia;
      const heroTitle = getAnimeTitle(heroMedia);
      const desc = sanitizeHtml(heroMedia.description);
      const heroCover = document.getElementById('hero-cover');
      if (heroCover) heroCover.src = getCoverImage(heroMedia);
      const heroTitleEl = document.getElementById('hero-title');
      if (heroTitleEl) {
        heroTitleEl.textContent = heroTitle;
        heroTitleEl.title = heroTitle;
      }
      const heroDesc = document.getElementById('hero-desc');
      if (heroDesc) {
        heroDesc.textContent = desc;
        heroDesc.classList.toggle('hidden', !desc);
      }
      const heroScore = document.getElementById('hero-score');
      if (heroScore) heroScore.textContent = '★ ' + (heroMedia.averageScore || heroMedia.meanScore || '—') + '%';
      const heroMeta = document.getElementById('hero-meta');
      if (heroMeta) heroMeta.textContent = (heroMedia.format || 'TV') + ' · ' + (heroMedia.episodes ? heroMedia.episodes + ' episodes' : 'releasing');
      const heroListBadge = document.getElementById('hero-list-badge');
      if (heroListBadge) heroListBadge.classList.toggle('hidden', !isMediaOnList(heroMedia));
      const addButton = document.getElementById('hero-btn-add');
      const inspectButton = document.getElementById('hero-btn-inspect');
      if (addButton) {
        addButton.replaceWith(addButton.cloneNode(true));
        document.getElementById('hero-btn-add').addEventListener('click', () => quickAddWatching(heroMedia.id, heroTitle));
      }
      if (inspectButton) {
        inspectButton.replaceWith(inspectButton.cloneNode(true));
        document.getElementById('hero-btn-inspect').addEventListener('click', () => openMediaDetail(heroMedia.id));
      }
    } else {
      hero?.classList.add('hidden');
    }

    const grid = document.getElementById('discover-grid');
    if (!grid) return;
    grid.innerHTML = list.length
      ? list.map(m => renderDiscoverCardHtml(m)).join('')
      : `<div class="col-span-full py-16 text-center text-slate-400 font-mono text-xs"><i class="fa-solid fa-magnifying-glass text-2xl text-rose-500 dark:text-cyan-400 mb-2"></i><p>No titles match these filters.</p></div>`;
  }

  // Render Airing from your list strip
  function renderAiringRadar() {
    if (typeof document === 'undefined') return;
    const radar = document.getElementById('airing-radar');
    if (!radar) return;
    const schedules = (state.airingRadar || []).slice(0, 6);
    radar.innerHTML = schedules.length
      ? schedules.map(item => renderAiringRadarItemHtml(item)).join('')
      : `<div class="w-full py-4 text-center text-slate-500 dark:text-slate-400 text-xs">No airing titles from your list this week.</div>`;
  }

  // Render the full-width seasonal chart
  function renderSeasonalChart(errorMessage = null) {
    if (typeof document === 'undefined') return;
    const chart = document.getElementById('seasonal-chart');
    if (!chart) return;

    if (!seasonalChartInitialized && !errorMessage) {
      chart.innerHTML = `<div class="col-span-full py-12 text-center text-slate-400 text-xs">Seasonal chart loads when you reach this section.</div>`;
      return;
    }

    let items = Array.isArray(state.seasonalChart) ? [...state.seasonalChart] : [];
    if (state.discoverChartTab === 'Upcoming') items = items.filter(m => Boolean(m.nextAiringEpisode));
    if (state.discoverChartTab === 'TBA') items = items.filter(m => !m.nextAiringEpisode);
    if (state.hideOnMyList) items = items.filter(m => !isMediaOnList(m));

    if (items.length === 0) {
      const message = errorMessage ? 'Failed to load seasonal data: ' + escapeHtml(errorMessage) : 'No titles for this season and filter.';
      chart.innerHTML = `<div class="col-span-full py-12 text-center text-slate-500 dark:text-slate-400 font-mono text-xs"><i class="fa-solid fa-calendar-xmark text-xl text-rose-500 dark:text-cyan-400 mb-2"></i><p>${message}</p></div>`;
      return;
    }
    chart.innerHTML = items.slice(0, 30).map(m => renderSeasonalItemHtml(m)).join('');
  }

  // ==============================================================
  // MEDIA DETAIL ART SHEET MODAL  // MEDIA DETAIL ART SHEET MODAL (B1: Fully Escaped)
  // ==============================================================
  async function openMediaDetail(mediaId) {
    if (!mediaId || typeof document === 'undefined') return;
    state.activeMediaDetailId = mediaId;
    const modal = document.getElementById('media-detail-modal');
    const content = document.getElementById('media-detail-content');
    if (!content) return;

    openModal(modal);
    content.innerHTML = `
      <div class="py-24 flex flex-col items-center justify-center text-slate-400">
        <i class="fa-solid fa-spinner fa-spin text-3xl mb-3 text-cyan-400"></i>
        <p class="text-sm font-semibold">Loading media sheet...</p>
      </div>
    `;

    try {
      const QUERY = `
        query ($id: Int) {
          Media(id: $id, type: ANIME) {
            id
            idMal
            title { romaji english native userPreferred }
            coverImage { extraLarge large medium color }
            bannerImage
            format
            status
            episodes
            duration
            season
            seasonYear
            averageScore
            meanScore
            popularity
            favourites
            source
            genres
            synonyms
            description(asHtml: false)
            studios(isMain: true) { nodes { name } }
            startDate { year month day }
            endDate { year month day }
            nextAiringEpisode { episode airingAt timeUntilAiring }
            airingSchedule(page: 1, perPage: 25) {
              nodes { id episode airingAt timeUntilAiring }
            }
            relations {
              edges {
                relationType
                node {
                  id
                  type
                  title { romaji english native userPreferred }
                }
              }
            }
            characters(sort: [ROLE, RELEVANCE], perPage: 24) {
              edges {
                role
                node {
                  id
                  name { full }
                  image { large medium }
                }
                voiceActors {
                  language
                  name { full }
                }
              }
            }
            mediaListEntry {
              id
              status
              score
              progress
              repeat
              notes
            }
          }
        }
      `;
      let media = null;
      try {
        const data = await queryAniList(QUERY, { id: parseInt(mediaId, 10) });
        media = data?.Media;
      } catch (e) {}

      if (!media) {
        const res = await fetch(`/api/anilist/media/${mediaId}`);
        if (res.ok) {
          const payload = await res.json();
          media = payload?.media || payload;
        }
      }

      if (!media) {
        const allItems = [...FALLBACK_DATA.trending, ...FALLBACK_DATA.popular, ...FALLBACK_DATA.top, ...FALLBACK_DATA.seasonal];
        media = allItems.find(x => x.id === parseInt(mediaId, 10)) || FALLBACK_DATA.trending[0];
      }

      state.activeMediaDetail = media;

      const title = escapeHtml(getAnimeTitle(media));
      const coverUrl = getCoverImage(media);
      const cover = escapeHtml(coverUrl);
      const banner = escapeHtml(media.bannerImage || coverUrl);
      const score = escapeHtml(media.averageScore || media.meanScore || '—');
      const desc = sanitizeHtml(media.description) || 'Rich metadata from AniList GraphQL directory.';
      const studioName = media.studios?.nodes?.find(item => item?.name)?.name || '';
      const studio = escapeHtml(studioName || 'Animation Studio');
      const genreItems = Array.isArray(media.genres) ? media.genres.filter(Boolean) : [];
      const genres = genreItems.length
        ? genreItems.map(g => `<span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300">${escapeHtml(g)}</span>`).join('')
        : '<span class="text-xs text-slate-500 dark:text-slate-400">No genres listed.</span>';

      const formatAirDate = timestamp => {
        const value = Number(timestamp);
        return Number.isFinite(value) && value > 0 ? new Date(value * 1000).toLocaleString() : '';
      };
      const renderAirDate = timestamp => {
        const date = formatAirDate(timestamp);
        return date ? `<span>${escapeHtml(date)}</span>` : '';
      };
      const nextAiring = media.nextAiringEpisode;
      const airingSchedule = Array.isArray(media.airingSchedule?.nodes) ? media.airingSchedule.nodes : [];
      const scheduleRows = airingSchedule
        .filter(item => item && (!nextAiring?.id || String(item.id) !== String(nextAiring.id)))
        .slice(0, 5)
        .map(item => `
          <div class="flex items-center justify-between gap-3 py-2 border-t border-slate-200 dark:border-slate-800 text-xs">
            <span class="font-mono text-slate-500 dark:text-slate-400">Episode ${escapeHtml(item.episode ?? '—')}</span>
            <span class="text-right text-slate-600 dark:text-slate-300">${renderAirDate(item.airingAt) || escapeHtml(formatCountdown(item.timeUntilAiring))}</span>
          </div>
        `).join('');
      const airing = nextAiring
        ? `
          <div class="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-cyan-50 dark:bg-cyan-950/20 border border-cyan-200 dark:border-cyan-900/50 px-3 py-2.5">
            <div>
              <p class="text-[10px] uppercase tracking-wider font-bold text-cyan-700 dark:text-cyan-300">Next episode</p>
              <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">Episode ${escapeHtml(nextAiring.episode ?? '—')}</p>
            </div>
            <div class="text-right text-xs font-mono text-cyan-700 dark:text-cyan-300">
              <p>${escapeHtml(formatCountdown(nextAiring.timeUntilAiring))}</p>
              ${renderAirDate(nextAiring.airingAt)}
            </div>
          </div>
          ${scheduleRows ? `<div class="mt-2">${scheduleRows}</div>` : ''}
        `
        : '<p class="text-xs text-slate-500 dark:text-slate-400">No upcoming airing information.</p>';

      const relationEdges = Array.isArray(media.relations?.edges)
        ? media.relations.edges.filter(edge => edge?.node)
        : [];
      const relations = relationEdges.length
        ? relationEdges.map(edge => {
          const relationId = Number(edge.node.id) || 0;
          const relationTitle = escapeHtml(getAnimeTitle(edge.node));
          const relationType = escapeHtml(edge.relationType || edge.node.type || 'Related');
          const relationLink = relationId
            ? `<button type="button" data-action="open-detail" data-media-id="${escapeHtml(relationId)}" class="text-left text-sm font-semibold text-slate-800 dark:text-slate-100 hover:text-cyan-500 dark:hover:text-cyan-300 transition-colors">${relationTitle}</button>`
            : `<span class="text-sm font-semibold text-slate-800 dark:text-slate-100">${relationTitle}</span>`;
          return `
            <div class="flex items-center justify-between gap-3 py-2 border-b last:border-b-0 border-slate-200 dark:border-slate-800">
              ${relationLink}
              <span class="shrink-0 text-[10px] font-mono uppercase tracking-wider text-slate-500 dark:text-slate-400">${relationType}</span>
            </div>
          `;
        }).join('')
        : '<p class="text-xs text-slate-500 dark:text-slate-400">No related titles listed.</p>';

      const characterEdges = Array.isArray(media.characters?.edges)
        ? media.characters.edges.filter(edge => edge?.node)
        : [];
      const renderCharacter = edge => {
        const character = edge.node;
        const characterName = escapeHtml(character.name?.full || 'Unknown character');
        const characterRole = escapeHtml(edge.role || 'Supporting');
        const characterImageUrl = character.image?.large || character.image?.medium;
        const characterImage = characterImageUrl
          ? `<img src="${escapeHtml(characterImageUrl)}" alt="${characterName}" loading="lazy" class="w-14 h-20 rounded-lg object-cover bg-slate-100 dark:bg-slate-800 shrink-0">`
          : '<div class="w-14 h-20 rounded-lg bg-slate-100 dark:bg-slate-800 shrink-0 flex items-center justify-center text-slate-400"><i class="fa-solid fa-user"></i></div>';
        const voiceActors = Array.isArray(edge.voiceActors) ? edge.voiceActors.filter(actor => actor?.name?.full) : [];
        const voices = voiceActors.length
          ? voiceActors.map(actor => {
            const language = String(actor.language || '');
            const languageLabel = language === 'Japanese' ? 'JP' : language === 'English' ? 'EN' : language;
            return `<span class="inline-flex items-center gap-1 text-[10px] text-slate-600 dark:text-slate-300"><span>${escapeHtml(actor.name.full)}</span>${languageLabel ? `<span class="px-1 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-mono text-[9px]">${escapeHtml(languageLabel)}</span>` : ''}</span>`;
          }).join('')
          : '<span class="text-[10px] text-slate-500 dark:text-slate-400">Voice actor unavailable</span>';
        return `
          <article class="flex gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/30 p-2.5">
            ${characterImage}
            <div class="min-w-0 flex flex-col justify-center gap-1">
              <h4 class="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate" title="${characterName}">${characterName}</h4>
              <p class="text-[10px] font-mono uppercase tracking-wider text-cyan-600 dark:text-cyan-300">${characterRole}</p>
              <div class="flex flex-col gap-0.5">${voices}</div>
            </div>
          </article>
        `;
      };
      const characterCards = characterEdges.map(renderCharacter);
      const characterMore = characterCards.slice(12).join('');
      const characters = characterCards.length
        ? `
          <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5">${characterCards.slice(0, 12).join('')}</div>
          ${characterMore ? `
            <details class="mt-3 group">
              <summary class="cursor-pointer list-none text-center text-[11px] font-mono text-slate-500 dark:text-slate-400 hover:text-cyan-500 dark:hover:text-cyan-300 transition-colors">Show all ${escapeHtml(characterCards.length)} characters <span class="group-open:hidden">↓</span><span class="hidden group-open:inline">↑</span></summary>
              <div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 mt-3">${characterMore}</div>
            </details>
          ` : ''}
        `
        : '<p class="text-xs text-slate-500 dark:text-slate-400">No character information listed.</p>';
      const listEntry = media.mediaListEntry || state.listEntriesByMedia[media.id];
      const entryStatus = listEntry ? escapeHtml(listEntry.status) : '';
      const format = escapeHtml(media.format || 'TV');
      const eps = escapeHtml(media.episodes ? `${media.episodes} Episodes` : 'Releasing');
      const seasonStr = escapeHtml(`${media.season || ''} ${media.seasonYear || ''}`.trim());
      const safeId = escapeHtml(Number(media.id) || 0);

      content.innerHTML = `
        <!-- Banner Header -->
        <div class="relative h-48 sm:h-64 w-full overflow-hidden bg-slate-900">
          <img src="${banner}" alt="Banner" class="w-full h-full object-cover opacity-60">
          <div class="absolute inset-0 bg-gradient-to-t from-[#0d1322] via-[#0d1322]/40 to-transparent"></div>
          <div class="absolute bottom-4 left-4 sm:left-6 flex items-end gap-4 z-10">
            <img src="${cover}" alt="${title}" class="w-20 h-28 sm:w-28 sm:h-40 rounded-2xl object-cover shadow-2xl border-2 border-white/20">
            <div class="flex flex-col gap-1 pb-1">
              <span class="text-xs font-mono text-cyan-400 font-bold uppercase tracking-wider">${format} • ${studio}</span>
              <h2 class="text-lg sm:text-2xl font-bold font-display text-white max-w-xl line-clamp-1">${title}</h2>
              <div class="flex items-center gap-3 text-xs text-slate-300 font-mono">
                <span class="text-amber-400 font-bold">★ ${score}% Score</span>
                <span>•</span>
                <span>${eps}</span>
                <span>•</span>
                <span>${seasonStr}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Body Content -->
        <div class="p-4 sm:p-6 space-y-6">
          <!-- Action Buttons Bar -->
          <div class="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-slate-50 dark:bg-[#111827] border border-slate-200 dark:border-slate-800">
            <div class="flex items-center gap-2">
              <button data-action="open-list-editor" data-media-id="${safeId}" class="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-obsidian-950 font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2">
                <i class="fa-solid fa-list-check"></i>
                <span>${listEntry ? `Status: ${entryStatus}` : '+ Add to AniList'}</span>
              </button>
              <button data-action="nyaa-search" data-media-id="${safeId}" data-media-title="${title}" class="px-4 py-2 bg-pink-500 hover:bg-pink-400 text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer flex items-center gap-2">
                <i class="fa-solid fa-download"></i>
                <span>Search Torrents</span>
              </button>
            </div>
            <a href="https://anilist.co/anime/${safeId}" target="_blank" rel="noopener" class="text-xs font-mono text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1.5">
              <span>View on AniList</span>
              <i class="fa-solid fa-arrow-up-right-from-square text-[10px]"></i>
            </a>
          </div>

          <!-- Genres + Airing -->
          <div class="grid gap-4 lg:grid-cols-2">
            <section class="space-y-2">
              <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Genres</h3>
              <div class="flex flex-wrap gap-1.5">${genres}</div>
            </section>
            <section class="space-y-2">
              <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Airing</h3>
              ${airing}
            </section>
          </div>

          <!-- Synopsis -->
          <div class="space-y-2">
            <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Synopsis</h3>
            <p class="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar pr-2">${desc}</p>
          </div>

          <!-- Relations -->
          <section class="space-y-2">
            <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Relations</h3>
            <div class="rounded-xl border border-slate-200 dark:border-slate-800 px-3">${relations}</div>
          </section>

          <!-- Characters -->
          <section class="space-y-2">
            <div class="flex items-center justify-between gap-3">
              <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Characters</h3>
              ${characterEdges.length ? `<span class="text-[10px] font-mono text-slate-500 dark:text-slate-400">${escapeHtml(characterEdges.length)} listed</span>` : ''}
            </div>
            ${characters}
          </section>

          <!-- Studio -->
          <section class="space-y-2">
            <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Studio</h3>
            <p class="text-sm font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(studioName || '—')}</p>
          </section>
        </div>
      `;
    } catch (err) {
      content.innerHTML = `
        <div class="p-8 text-center text-rose-500">
          <i class="fa-solid fa-circle-exclamation text-3xl mb-3"></i>
          <p class="text-sm font-semibold">${escapeHtml(err.message)}</p>
        </div>
      `;
    }
  }

  // ==============================================================
  // WATCHING PANEL CONTROLLER
  // ==============================================================
  async function loadWatching() {
    if (typeof document === 'undefined') return;
    const grid = document.getElementById('anime-grid');
    if (!grid) return;
    const token = tabToken;

    try {
      const payload = await API.getAnimeList();
      if (isStaleTab(token)) return;
      state.animeList = Array.isArray(payload) ? payload : (payload?.anime || []);
      state.animeListLoaded = true;
      state.animeList.forEach(entry => {
        const id = Number(entry.mediaId || entry.id);
        if (id) state.listEntriesByMedia[id] = { ...state.listEntriesByMedia[id], mediaId: id, status: 'CURRENT', progress: entry.progress || 0 };
      });

      // Update badge count
      const count = state.animeList.length;
      const badge = document.getElementById('watching-badge');
      if (badge) badge.textContent = count;

      if (state.animeList.length === 0) {
        grid.innerHTML = `
          <div class="col-span-full py-16 text-center text-slate-400 font-mono text-xs">
            <i class="fa-solid fa-tv text-3xl text-cyan-400/50 mb-3"></i>
            <p>No anime currently tracked in Watching cockpit.</p>
            <button data-action="switch-tab" data-target-tab="discover" class="mt-4 px-4 py-2 bg-cyan-500 text-obsidian-950 rounded-xl text-xs font-bold cursor-pointer">Discover Anime</button>
          </div>
        `;
        return;
      }

      grid.innerHTML = state.animeList.map(a => renderWatchingItemHtml(a)).join('');
    } catch (err) {
      if (isStaleTab(token)) return;
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
    }
  }

  // ==============================================================
  // LISTS PANEL CONTROLLER
  // ==============================================================
  async function loadUserListsData() {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('lists-entries-container');
    if (!container) return;
    const token = tabToken;
    container.innerHTML = `<div class="py-16 text-center text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading collection...</div>`;

    try {
      const type = state.listsMediaType || 'ANIME';
      const res = await fetch(`/api/anilist/user-list?userName=${encodeURIComponent(state.userName || '')}&type=${type}&perChunk=500`);
      if (isStaleTab(token)) return;
      if (!res.ok) throw new Error('Failed to load user lists from AniList');
      const data = await res.json();
      if (isStaleTab(token)) return;
      state.userListsData = data;

      // Flatten entries and calculate counts
      const lists = data.lists || [];
      let allEntries = [];
      const counts = { ALL: 0, CURRENT: 0, REPEATING: 0, COMPLETED: 0, PAUSED: 0, DROPPED: 0, PLANNING: 0 };

      lists.forEach(l => {
        (l.entries || []).forEach(entry => {
          allEntries.push(entry);
          counts.ALL++;
          if (entry.status && counts[entry.status] !== undefined) {
            counts[entry.status]++;
          }
          if (entry.mediaId) {
            state.listEntriesByMedia[entry.mediaId] = entry;
          }
        });
      });

      // Update count tags
      ['all', 'current', 'repeating', 'completed', 'paused', 'dropped', 'planning'].forEach(k => {
        const el = document.getElementById(`cnt-${k}`);
        if (el) el.textContent = counts[k.toUpperCase()] || 0;
      });

      renderListEntries(allEntries);
    } catch (err) {
      if (isStaleTab(token)) return;
      container.innerHTML = `<div class="py-12 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderListEntries(entries) {
    if (typeof document === 'undefined') return;
    const container = document.getElementById('lists-entries-container');
    if (!container) return;

    let filtered = entries;
    if (state.listsStatusGroup !== 'ALL') {
      filtered = filtered.filter(e => e.status === state.listsStatusGroup);
    }
    if (state.listsSearch) {
      filtered = filtered.filter(e => {
        const title = getAnimeTitle(e.media || e).toLowerCase();
        return title.includes(state.listsSearch.toLowerCase());
      });
    }

    if (filtered.length === 0) {
      container.innerHTML = `<div class="py-16 text-center text-slate-400 text-xs font-mono">No entries matched the selected filter.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3 sm:gap-4">
        ${filtered.map(entry => renderListEntryHtml(entry)).join('')}
      </div>
    `;
  }

  // ==============================================================
  // GLOBAL SEARCH CONTROLLER
  // ==============================================================
  async function performSearch() {
    if (typeof document === 'undefined') return;
    const grid = document.getElementById('search-results-grid');
    if (!grid) return;
    const token = tabToken;
    grid.innerHTML = `<div class="col-span-full py-16 text-center text-slate-400 text-sm"><i class="fa-solid fa-spinner fa-spin mr-2 text-cyan-400"></i>Executing search...</div>`;

    const term = state.searchQuery || document.getElementById('global-search-input')?.value.trim();
    const entity = state.searchEntity || 'ANIME';

    try {
      const QUERY = `
        query ($search: String, $type: MediaType, $page: Int, $perPage: Int) {
          Page(page: $page, perPage: $perPage) {
            pageInfo { hasNextPage }
            media(search: $search, type: $type, isAdult: false) {
              id
              title { romaji english native userPreferred }
              coverImage { large medium color }
              format
              episodes
              averageScore
              status
            }
          }
        }
      `;
      let items = [];
      try {
        const data = await queryAniList(QUERY, { search: term || undefined, type: entity === 'MANGA' ? 'MANGA' : 'ANIME', page: 1, perPage: 20 });
        items = data?.Page?.media || [];
      } catch (e) {}

      if (items.length === 0 && term) {
        try {
          const res = await fetch(`/api/anilist/search?query=${encodeURIComponent(term)}&type=${entity === 'MANGA' ? 'MANGA' : 'ANIME'}`);
          if (res.ok) {
            const json = await res.json();
            items = json.media || json.results || [];
          }
        } catch (e) {}
      }

      if (items.length === 0) {
        items = FALLBACK_DATA.trending.slice(0, 10);
      }

      if (isStaleTab(token)) return;
      state.searchResults = items;
      grid.innerHTML = items.map(m => renderSearchResultHtml(m)).join('');
    } catch (err) {
      if (isStaleTab(token)) return;
      grid.innerHTML = `<div class="col-span-full py-12 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
    }
  }

  // ==============================================================
  // SOCIAL PANEL CONTROLLER
  // ==============================================================
  async function loadSocialFeed() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('activity-feed-list');
    if (!list) return;
    const token = tabToken;
    list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading activity feed...</div>`;

    try {
      const QUERY = `
        query {
          Page(page: 1, perPage: 15) {
            activities(isFollowing: true, type_in: [TEXT, ANIME_LIST]) {
              ... on TextActivity {
                id
                text
                createdAt
                user { name avatar { medium } }
              }
              ... on ListActivity {
                id
                type
                status
                progress
                createdAt
                user { name avatar { medium } }
                media { id title { romaji userPreferred } coverImage { medium } }
              }
            }
          }
        }
      `;
      let acts = [];
      try {
        const data = await queryAniList(QUERY);
        acts = data?.Page?.activities || [];
      } catch (e) {}

      if (acts.length === 0) {
        const res = await fetch('/api/anilist/activity');
        if (res.ok) {
          const json = await res.json();
          acts = json.activities || [];
        }
      }

      if (isStaleTab(token)) return;

      if (acts.length === 0) {
        list.innerHTML = `<div class="py-8 text-center text-slate-400 text-xs font-mono">No recent activity from followed users.</div>`;
        return;
      }

      list.innerHTML = acts.map(a => renderSocialActivityHtml(a)).join('');
    } catch (err) {
      if (isStaleTab(token)) return;
      list.innerHTML = `<div class="py-8 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
    }
  }

  // ==============================================================
  // STATS PANEL CONTROLLER
  // ==============================================================
  async function loadUserStats() {
    if (typeof document === 'undefined') return;
    const token = tabToken;
    try {
      const QUERY = `
        query ($name: String) {
          User(name: $name) {
            statistics {
              anime {
                count
                meanScore
                minutesWatched
                episodesWatched
                genres(limit: 6, sort: COUNT_DESC) { genre count }
                formats(limit: 4, sort: COUNT_DESC) { format count }
              }
            }
          }
        }
      `;
      let stats = null;
      try {
        const data = await queryAniList(QUERY, { name: state.userName || undefined });
        stats = data?.User?.statistics?.anime;
      } catch (e) {}

      if (!stats) {
        const res = await fetch(`/api/anilist/user/${state.userName || 'viewer'}`);
        if (res.ok) {
          const json = await res.json();
          stats = json.statistics?.anime;
        }
      }

      if (isStaleTab(token) || !stats) return;

      const elTotalAnime = document.getElementById('stat-total-anime');
      if (elTotalAnime) elTotalAnime.textContent = stats.count || 0;
      const elDaysWatched = document.getElementById('stat-days-watched');
      if (elDaysWatched) elDaysWatched.textContent = (stats.minutesWatched ? (stats.minutesWatched / 1440).toFixed(1) : '0.0');
      const elMeanScore = document.getElementById('stat-mean-score');
      if (elMeanScore) elMeanScore.textContent = stats.meanScore || '0.0';
      const elTotalEpisodes = document.getElementById('stat-total-episodes');
      if (elTotalEpisodes) elTotalEpisodes.textContent = stats.episodesWatched || 0;

      const genreBox = document.getElementById('chart-genre-container');
      if (genreBox && stats.genres) {
        genreBox.innerHTML = stats.genres.map(g => `
          <div class="space-y-1">
            <div class="flex justify-between text-xs font-semibold">
              <span>${escapeHtml(g.genre)}</span>
              <span class="font-mono text-cyan-400">${escapeHtml(g.count)}</span>
            </div>
            <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full bg-cyan-500 rounded-full" style="width: ${Math.min(100, (g.count / (stats.count || 1)) * 100)}%"></div>
            </div>
          </div>
        `).join('');
      }

      const formatBox = document.getElementById('chart-format-container');
      if (formatBox && stats.formats) {
        formatBox.innerHTML = stats.formats.map(f => `
          <div class="space-y-1">
            <div class="flex justify-between text-xs font-semibold">
              <span>${escapeHtml(f.format)}</span>
              <span class="font-mono text-pink-400">${escapeHtml(f.count)}</span>
            </div>
            <div class="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div class="h-full bg-pink-500 rounded-full" style="width: ${Math.min(100, (f.count / (stats.count || 1)) * 100)}%"></div>
            </div>
          </div>
        `).join('');
      }
    } catch (err) {
      console.warn('Stats query failed:', err);
    }
  }

  // ==============================================================
  // HISTORY & LOGS PANEL CONTROLLERS
  // ==============================================================
  async function loadDownloadHistory() {
    if (typeof document === 'undefined') return;
    const list = document.getElementById('history-list');
    if (!list) return;
    const token = tabToken;
    list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2"></i>Loading history...</div>`;

    try {
      const history = await API.getDownloadHistory();
      if (isStaleTab(token)) return;

      if (!history || history.length === 0) {
        list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-mono">No previous download history recorded.</div>`;
        return;
      }

      list.innerHTML = history.map(h => renderHistoryItemHtml(h)).join('');
    } catch (err) {
      if (isStaleTab(token)) return;
      list.innerHTML = `<div class="py-8 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
    }
  }

  async function loadLogs() {
    if (typeof document === 'undefined') return;
    const logsBody = document.getElementById('logs-body');
    if (!logsBody) return;
    const token = tabToken;
    try {
      const logName = document.getElementById('log-select')?.value || 'combined';
      const lines = document.getElementById('log-lines')?.value || 250;
      const data = await API.getLogs(logName, lines);
      if (isStaleTab(token)) return;
      logsBody.textContent = data.logs || data.content || 'No logs found.';
      logsBody.scrollTop = logsBody.scrollHeight;
    } catch (err) {
      if (isStaleTab(token)) return;
      logsBody.textContent = `Error loading logs: ${err.message}`;
    }
  }

  // ==============================================================
  // SETTINGS PANEL CONTROLLER
  // ==============================================================
  async function loadSettingsConfig() {
    if (typeof document === 'undefined') return;
    const token = tabToken;
    try {
      const config = await API.getConfig();
      if (isStaleTab(token) || !config) return;
      state.config = config;

      const form = document.getElementById('profile-config-form');
      if (form) {
        Object.keys(config).forEach(key => {
          const input = form.querySelector(`[name="${key}"]`);
          if (input) {
            if (input.type === 'checkbox') {
              input.checked = Boolean(config[key]);
            } else {
              input.value = config[key] || '';
            }
          }
        });
      }

      state.userName = config.aniUserName || '';
      state.userId = config.id || null;
      state.titleLang = config.titleLanguage || 'romaji';
      state.titleLanguage = config.titleLanguage || 'romaji';

      const userTag = document.getElementById('user-display-name');
      if (userTag) userTag.textContent = state.userName || 'Otaku';

      // Update OAuth status indicator
      const authIndicator = document.getElementById('auth-status-indicator');
      const authText = document.getElementById('auth-status-text');
      if (config.hasBearerToken || config.bearerTokenAnilist) {
        if (authIndicator) authIndicator.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 inline-block shrink-0';
        if (authText) authText.textContent = 'OAuth Status: Connected';
      } else {
        if (authIndicator) authIndicator.className = 'w-2.5 h-2.5 rounded-full bg-slate-400 inline-block shrink-0';
        if (authText) authText.textContent = 'OAuth Status: Offline';
      }
    } catch (err) {
      console.warn('Failed to load settings config:', err);
    }
  }

  // ==============================================================
  // LIST EDITOR MODAL CONTROLLER
  // ==============================================================
  async function openListEditor(mediaId) {
    if (!mediaId || typeof document === 'undefined') return;
    const modal = document.getElementById('list-editor-modal');
    openModal(modal);
    const mediaIdInput = document.getElementById('editor-media-id');
    if (mediaIdInput) mediaIdInput.value = mediaId;
    const entry = state.listEntriesByMedia[mediaId];

    if (entry) {
      document.getElementById('editor-status').value = entry.status || 'CURRENT';
      document.getElementById('editor-progress').value = entry.progress || 0;
      document.getElementById('editor-score').value = entry.score || 0;
      document.getElementById('editor-notes').value = entry.notes || '';
      document.getElementById('editor-repeat').value = entry.repeat || 0;
    } else {
      document.getElementById('editor-status').value = 'CURRENT';
      document.getElementById('editor-progress').value = 0;
      document.getElementById('editor-score').value = 0;
      document.getElementById('editor-notes').value = '';
      document.getElementById('editor-repeat').value = 0;
    }
  }

  // ==============================================================
  // NYAA MODAL CONTROLLER (B1: Escaped & Safe)
  // ==============================================================
  async function openNyaaModal(mediaId, title) {
    if (typeof document === 'undefined') return;
    const modal = document.getElementById('nyaa-dialog');
    openModal(modal);
    const titleEl = document.getElementById('nyaa-dialog-title');
    if (titleEl) titleEl.textContent = `Search Nyaa.si — ${title || 'Anime'}`;
    const list = document.getElementById('nyaa-candidates-list');
    if (list) {
      list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs"><i class="fa-solid fa-spinner fa-spin mr-2 text-pink-400"></i>Indexing torrent candidates...</div>`;
    }

    try {
      const data = await API.searchNyaa(mediaId);
      const candidates = data.candidates || data.results || [];

      if (candidates.length === 0) {
        if (list) list.innerHTML = `<div class="py-12 text-center text-slate-400 text-xs font-mono">No matching torrents found on Nyaa.si.</div>`;
        return;
      }

      if (list) {
        list.innerHTML = candidates.map(c => renderNyaaCandidateHtml(c, mediaId)).join('');
      }
    } catch (err) {
      if (list) list.innerHTML = `<div class="py-8 text-center text-rose-500 text-xs">${escapeHtml(err.message)}</div>`;
    }
  }

  async function downloadTorrent(mediaId, encodedLink, episode) {
    try {
      const link = decodeURIComponent(encodedLink);
      showToast('Sending torrent to qBittorrent queue...', 'info');
      await API.downloadNyaa(mediaId, link, episode);
      showToast('Torrent queued successfully in qBittorrent!', 'success');
      if (typeof document !== 'undefined') {
        closeModal(document.getElementById('nyaa-dialog'));
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  // ==============================================================
  // MODAL UTILITIES
  // ==============================================================
  function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('opacity-0', 'pointer-events-none');
    const inner = modal.querySelector('.scale-95');
    if (inner) inner.classList.remove('scale-95');
  }

  function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('opacity-0', 'pointer-events-none');
    const inner = modal.querySelector('.transform, .scale-95');
    if (inner) inner.classList.add('scale-95');
  }

  // ==============================================================
  // DELEGATED EVENT LISTENER SETUP (B1: Eliminates inline handlers)
  // ==============================================================
  function setupDelegatedActions() {
    if (typeof document === 'undefined') return;

    document.addEventListener('click', (e) => {
      const actionEl = e.target.closest('[data-action]');
      if (!actionEl) return;

      const action = actionEl.dataset.action;
      const mediaId = actionEl.dataset.mediaId ? parseInt(actionEl.dataset.mediaId, 10) : null;
      const title = actionEl.dataset.mediaTitle || '';

      if (action === 'open-detail' && mediaId) {
        openMediaDetail(mediaId);
      } else if (action === 'nyaa-search' && mediaId) {
        e.stopPropagation();
        quickNyaaSearch(mediaId, title);
      } else if (action === 'quick-add' && mediaId) {
        e.stopPropagation();
        quickAddWatching(mediaId, title);
      } else if (action === 'open-list-editor' && mediaId) {
        e.stopPropagation();
        openListEditor(mediaId);
      } else if (action === 'download-torrent' && mediaId) {
        e.stopPropagation();
        downloadTorrent(mediaId, actionEl.dataset.torrentLink || '', parseInt(actionEl.dataset.episode, 10) || 1);
      } else if (action === 'switch-tab' && actionEl.dataset.targetTab) {
        e.stopPropagation();
        switchTab(actionEl.dataset.targetTab);
      }
    });

    // Close modal triggers
    document.querySelectorAll('[data-close], .dialog-close').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modal = btn.closest('#media-detail-modal, #list-editor-modal, #settings-dialog, #nyaa-dialog');
        if (modal) closeModal(modal);
      });
    });

    // Desktop navigation tabs
    document.querySelectorAll('.nav-tab').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab) switchTab(btn.dataset.tab);
      });
    });

    // Mobile navigation tabs
    DOM.mobileNavTabs.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.tab) {
          switchTab(btn.dataset.tab);
        }
      });
    });

    // Theme toggles
    document.querySelectorAll('.theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    });

    // Shared mobile menu
    document.getElementById('hamburger-btn')?.addEventListener('click', (event) => {
      const menu = document.getElementById('mobile-menu');
      menu?.classList.toggle('hidden');
      event.currentTarget.setAttribute('aria-expanded', String(!menu?.classList.contains('hidden')));
    });

    // Global Search Inputs
    function setupGlobalSearch(inputEl) {
      if (!inputEl) return;
      inputEl.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (state.activeTab === 'discover') {
          state.discoverSearchTerm = term;
          clearTimeout(discoverSearchTimer);
          discoverSearchTimer = setTimeout(renderDiscover, 300);
        }
      });
      inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          const val = inputEl.value.trim();
          if (val) {
            state.searchQuery = val;
            const searchInput = document.getElementById('global-search-input');
            if (searchInput) searchInput.value = val;
            switchTab('search');
            performSearch();
          }
        }
      });
    }
    setupGlobalSearch(document.getElementById('global-header-search'));

    // Command-K / Ctrl-K shortcut
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const search = document.getElementById('global-header-search');
        if (search) {
          search.focus();
          search.select();
        }
      }
    });

    // Lists Status Filter Tabs
    document.querySelectorAll('.list-status-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.list-status-tab').forEach(t => {
          t.className = 'list-status-tab px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:text-white shrink-0 cursor-pointer';
        });
        tab.className = 'list-status-tab px-4 py-2 rounded-xl bg-cyan-500 text-obsidian-950 shadow-sm shrink-0 cursor-pointer';
        state.listsStatusGroup = tab.dataset.statusGroup || 'ALL';
        if (state.userListsData) {
          let allEntries = [];
          (state.userListsData.lists || []).forEach(l => {
            (l.entries || []).forEach(e => allEntries.push(e));
          });
          renderListEntries(allEntries);
        }
      });
    });

    // Lists Search Filter
    document.getElementById('lists-search-input')?.addEventListener('input', (e) => {
      state.listsSearch = e.target.value.trim();
      if (state.userListsData) {
        let allEntries = [];
        (state.userListsData.lists || []).forEach(l => {
          (l.entries || []).forEach(e => allEntries.push(e));
        });
        renderListEntries(allEntries);
      }
    });

    // Filter drawer toggle in Search
    document.getElementById('btn-toggle-filters')?.addEventListener('click', () => {
      document.getElementById('search-filter-drawer')?.classList.toggle('hidden');
    });

    // Search Entity Tabs
    document.querySelectorAll('.search-entity-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.search-entity-tab').forEach(t => {
          t.className = 'search-entity-tab px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 hover:text-white shrink-0 cursor-pointer';
        });
        tab.className = 'search-entity-tab px-4 py-2 rounded-xl bg-cyan-500 text-obsidian-950 shadow-sm shrink-0 cursor-pointer';
        state.searchEntity = tab.dataset.entityTab || 'ANIME';
        performSearch();
      });
    });

    // History buttons
    document.getElementById('history-refresh-btn')?.addEventListener('click', loadDownloadHistory);
    document.getElementById('history-clear-btn')?.addEventListener('click', async () => {
      if (!confirm('Are you sure you want to clear your download history?')) return;
      try {
        await API.clearHistory();
        showToast('Download history cleared', 'success');
        loadDownloadHistory();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Logs buttons
    document.getElementById('log-refresh-btn')?.addEventListener('click', loadLogs);

    // Settings config submit
    document.getElementById('btn-submit-config')?.addEventListener('click', async (e) => {
      e.preventDefault();
      const form = document.getElementById('profile-config-form');
      if (!form) return;

      const formData = new FormData(form);
      const payload = {};
      formData.forEach((val, key) => {
        payload[key] = val;
      });

      try {
        await API.saveConfig(payload);
        showToast('Configuration saved & hotloaded successfully!', 'success');
        loadSettingsConfig();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Progress Inc/Dec
    document.getElementById('btn-progress-inc')?.addEventListener('click', () => {
      const input = document.getElementById('editor-progress');
      if (input) input.value = (parseInt(input.value, 10) || 0) + 1;
    });
    document.getElementById('btn-progress-dec')?.addEventListener('click', () => {
      const input = document.getElementById('editor-progress');
      if (input) input.value = Math.max(0, (parseInt(input.value, 10) || 0) - 1);
    });

    // Editor save
    document.getElementById('btn-editor-save')?.addEventListener('click', async () => {
      const mediaId = parseInt(document.getElementById('editor-media-id').value, 10);
      const status = document.getElementById('editor-status').value;
      const progress = parseInt(document.getElementById('editor-progress').value, 10) || 0;
      const score = parseFloat(document.getElementById('editor-score').value) || 0;
      const notes = document.getElementById('editor-notes').value;
      const repeat = parseInt(document.getElementById('editor-repeat').value, 10) || 0;

      try {
        await saveListEntryViaBackend({ mediaId, status, progress, scoreRaw: Math.round(score), notes, repeat });
        showToast('List entry updated successfully!', 'success');
        state.listEntriesByMedia[mediaId] = {
          ...(state.listEntriesByMedia[mediaId] || {}),
          mediaId, status, progress, score, notes, repeat
        };
        closeModal(document.getElementById('list-editor-modal'));
        if (state.activeTab === 'lists') loadUserListsData();
        if (state.activeTab === 'watching') loadWatching();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });

    // Notifications dropdown
    const toggleBtns = document.querySelectorAll('.notif-toggle-btn');
    toggleBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('notif-dropdown')?.classList.toggle('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.notif-toggle-btn, .notif-dropdown-panel')) {
        document.getElementById('notif-dropdown')?.classList.add('hidden');
      }
    });

    document.querySelectorAll('.btn-mark-all-read').forEach(btn => {
      btn.addEventListener('click', () => {
        state.unreadNotifications = 0;
        document.querySelectorAll('.notif-badge-shared').forEach(b => b.classList.add('hidden'));
        document.querySelectorAll('.notif-list-container').forEach(c => {
          c.innerHTML = `<p class="text-slate-400 text-center py-6">No new notifications</p>`;
        });
      });
    });
  }

  // Expose Global functions for inline HTML callers & tests
  if (typeof window !== 'undefined') {
    window.toggleTheme = toggleTheme;
    window.initTheme = initTheme;
    window.switchTab = switchTab;
    window.switchFeed = switchFeed;
    window.setDiscoverSeason = setDiscoverSeason;
    window.setDiscoverSubtab = setDiscoverSubtab;
    window.toggleHideMyList = toggleHideMyList;
    window.filterDiscoverFormat = filterDiscoverFormat;
    window.openMediaDetail = openMediaDetail;
    window.openListEditor = openListEditor;
    window.openNyaaModal = openNyaaModal;
    window.quickNyaaSearch = quickNyaaSearch;
    window.quickAddWatching = quickAddWatching;
    window.downloadTorrent = downloadTorrent;
    window.showToast = showToast;
    window.escapeHtml = escapeHtml;
    window.sanitizeHtml = sanitizeHtml;
    window.state = state;
    window.API = API;
  }

  // ==============================================================
  // INITIALIZATION ON DOM READY
  // ==============================================================
  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', async () => {
      initTheme();
      setupDelegatedActions();
      setupSeasonalObserver();
      await loadSettingsConfig();
      setDiscoverSeason(state.discoverSeason);
      switchTab('discover');
    });
  }

  return {
    state,
    API,
    FALLBACK_DATA,
    SUBTAB_STATUS_MAP,
    escapeHtml,
    sanitizeHtml,
    formatRelativeTime,
    formatCountdown,
    getAnimeTitle,
    formatTitle,
    getCoverImage,
    isMediaOnList,
    renderDiscoverCardHtml,
    renderAiringRadarItemHtml,
    renderSeasonalItemHtml,
    renderWatchingItemHtml,
    renderListEntryHtml,
    renderSearchResultHtml,
    renderSocialActivityHtml,
    renderHistoryItemHtml,
    renderNyaaCandidateHtml,
    showToastHtml,
    setDiscoverSeason,
    setDiscoverSubtab,
    toggleHideMyList,
    switchTab,
    switchFeed,
    isStaleTab
  };
});

