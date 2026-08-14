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
    theme: typeof localStorage !== 'undefined' ? (localStorage.getItem('theme') || 'dark') : 'dark',
    userName: '',
    userId: null,
    titleLang: typeof localStorage !== 'undefined' ? (localStorage.getItem('titleLanguage') || 'romaji') : 'romaji',
    titleLanguage: typeof localStorage !== 'undefined' ? (localStorage.getItem('titleLanguage') || 'romaji') : 'romaji',
    config: {},
    animeList: [],
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
    airingRadar: [...FALLBACK_DATA.trending],
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

  function getCoverImage(media) {
    if (!media) return SVG_PLACEHOLDER;
    if (media.coverImage) {
      return media.coverImage.large || media.coverImage.extraLarge || media.coverImage.medium || SVG_PLACEHOLDER;
    }
    if (media.image) return media.image;
    return SVG_PLACEHOLDER;
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
        const res = await fetch(`/api/anilist/discover?type=${encodeURIComponent(type || 'trending')}`);
        if (!res.ok) return { media: FALLBACK_DATA[type] || [] };
        return res.json();
      } catch (e) {
        return { media: FALLBACK_DATA[type] || [] };
      }
    },

    async getAiringToday(hours = 168) {
      try {
        const res = await fetch(`/api/anilist/airing-today?hours=${hours}`);
        if (!res.ok) return { schedules: FALLBACK_DATA.trending };
        return res.json();
      } catch (e) {
        return { schedules: FALLBACK_DATA.trending };
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

  function renderDiscoverCardHtml(m, theme = 'dark') {
    if (!m) return '';
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m));
    const score = escapeHtml(m.averageScore || m.meanScore || '—');
    const format = escapeHtml(m.format || 'TV');
    const eps = escapeHtml(m.episodes ? `${m.episodes} eps` : 'Airing');
    const year = escapeHtml(m.seasonYear || '2026');
    const nextAiring = m.nextAiringEpisode
      ? escapeHtml(`Ep ${m.nextAiringEpisode.episode} ${formatRelativeTime(m.nextAiringEpisode.timeUntilAiring)}`)
      : null;
    const mediaId = Number(m.id) || 0;

    if (theme === 'light') {
      return `
        <div class="group cursor-pointer bg-white hover:bg-white/90 hairline-border hover:border-editorial-slate400 rounded-xl overflow-hidden transition-all duration-200 flex flex-col justify-between relative card-shadow hover:-translate-y-0.5" data-action="open-detail" data-media-id="${mediaId}">
          <div class="relative aspect-[3/4.2] w-full overflow-hidden bg-slate-100">
            <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
            <div class="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-transparent to-transparent opacity-60 group-hover:opacity-30 transition-opacity"></div>
            
            <!-- Format Pill -->
            <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-white/95 text-editorial-slate900 border border-editorial-slate200 font-mono text-[10px] font-bold shadow-sm">
              ${format}
            </div>

            <!-- Score Badge -->
            <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-white/95 text-editorial-crimson border border-rose-200 font-mono text-[10px] font-bold shadow-sm">
              ★ ${score}%
            </div>

            ${nextAiring ? `
              <div class="absolute bottom-2 left-2 right-2 px-2 py-0.5 rounded bg-white/95 text-editorial-slate800 border border-editorial-slate200 text-[10px] font-mono truncate shadow-sm flex items-center gap-1">
                <span class="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0"></span>
                <span class="truncate">${nextAiring}</span>
              </div>
            ` : ''}

            <!-- Quick Action Overlay on Hover -->
            <div class="absolute inset-0 bg-slate-900/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2" onclick="event.stopPropagation()">
              <button data-action="nyaa-search" data-media-id="${mediaId}" data-media-title="${title}" class="p-2 rounded-lg bg-editorial-crimson text-white hover:bg-editorial-crimsonDark transition-all font-bold text-xs shadow-lg cursor-pointer" title="Search Torrents">
                <i class="fa-solid fa-download"></i>
              </button>
              <button data-action="open-detail" data-media-id="${mediaId}" class="p-2 rounded-lg bg-white text-editorial-slate900 hover:bg-slate-100 transition-all text-xs shadow cursor-pointer" title="Inspect Media">
                <i class="fa-solid fa-eye"></i>
              </button>
            </div>
          </div>

          <!-- Metadata Strip -->
          <div class="p-2.5 flex flex-col gap-1">
            <h4 class="font-bold text-xs text-editorial-slate900 line-clamp-1 group-hover:text-editorial-crimson transition-colors" title="${title}">${title}</h4>
            <div class="flex items-center justify-between text-[10px] text-editorial-slate500 font-mono">
              <span>${eps}</span>
              <span>${year}</span>
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="group cursor-pointer bg-[#0d1322] hover:bg-[#131b2e] hud-border hover:border-cyan-500/50 rounded-xl overflow-hidden transition-all duration-200 flex flex-col justify-between relative shadow-md hover:-translate-y-1" data-action="open-detail" data-media-id="${mediaId}">
        <div class="relative aspect-[3/4.2] w-full overflow-hidden bg-[#090d16]">
          <img src="${cover}" alt="${title}" loading="lazy" class="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300">
          <div class="absolute inset-0 bg-gradient-to-t from-[#090d16] via-transparent to-transparent opacity-80 group-hover:opacity-40 transition-opacity"></div>
          
          <!-- Format Pill -->
          <div class="absolute top-2 left-2 px-1.5 py-0.5 rounded bg-[#090d16]/90 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] font-bold shadow-sm">
            ${format}
          </div>

          <!-- Score Badge -->
          <div class="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-[#090d16]/90 border border-amber-500/30 text-amber-400 font-mono text-[10px] font-bold flex items-center gap-1 shadow-sm">
            ★ ${score}%
          </div>

          ${nextAiring ? `
            <div class="absolute bottom-2 left-2 right-2 px-2 py-0.5 rounded bg-[#090d16]/90 border border-cyan-500/30 text-cyan-300 text-[10px] font-mono truncate shadow-sm flex items-center gap-1">
              <span class="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-ping shrink-0"></span>
              <span class="truncate">${nextAiring}</span>
            </div>
          ` : ''}

          <!-- Quick Action Overlay on Hover -->
          <div class="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2 p-2" onclick="event.stopPropagation()">
            <button data-action="nyaa-search" data-media-id="${mediaId}" data-media-title="${title}" class="p-2 rounded-lg bg-cyan-500 text-obsidian-950 hover:bg-cyan-400 transition-all font-bold text-xs shadow-lg cursor-pointer" title="Search Torrents">
              <i class="fa-solid fa-download"></i>
            </button>
            <button data-action="open-detail" data-media-id="${mediaId}" class="p-2 rounded-lg bg-slate-800 text-white hover:bg-slate-700 transition-all text-xs border border-slate-600 cursor-pointer" title="Inspect Media">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
        </div>

        <!-- Metadata Info Strip -->
        <div class="p-2.5 flex flex-col gap-1">
          <h4 class="font-bold text-xs text-slate-100 line-clamp-1 group-hover:text-cyan-400 transition-colors" title="${title}">${title}</h4>
          <div class="flex items-center justify-between text-[10px] text-slate-400 font-mono">
            <span>${eps}</span>
            <span>${year}</span>
          </div>
        </div>
      </div>
    `;
  }

  function renderAiringRadarItemHtml(item, theme = 'dark') {
    if (!item) return '';
    const m = item.media || item;
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m));
    const ep = escapeHtml(item.episode || (m.nextAiringEpisode ? m.nextAiringEpisode.episode : 8));
    const countdown = escapeHtml(formatRelativeTime(item.timeUntilAiring !== undefined ? item.timeUntilAiring : 18000));
    const mediaId = Number(m.id) || 0;

    if (theme === 'light') {
      return `
        <div class="p-2.5 rounded-xl bg-editorial-slate100 hover:bg-editorial-slate200/80 border border-editorial-slate200 transition-colors flex items-center justify-between gap-2.5 group cursor-pointer" data-action="open-detail" data-media-id="${mediaId}">
          <div class="flex items-center gap-2.5 min-w-0">
            <img src="${cover}" alt="${title}" class="w-9 h-12 rounded-md object-cover flex-shrink-0 bg-white border border-editorial-slate200">
            <div class="flex flex-col min-w-0">
              <span class="text-xs font-semibold text-editorial-slate900 truncate group-hover:text-editorial-crimson transition-colors">${title}</span>
              <span class="text-[10px] font-mono text-editorial-slate500">Episode ${ep}</span>
            </div>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-white border border-editorial-slate200 text-editorial-crimson font-bold">${countdown}</span>
            <button data-action="quick-add" data-media-id="${mediaId}" data-media-title="${title}" class="px-2 py-1 rounded bg-editorial-slate900 text-white hover:bg-editorial-crimson text-[10px] font-mono transition-colors cursor-pointer" title="Sync Tracking">+ AutoSync</button>
          </div>
        </div>
      `;
    }

    return `
      <div class="p-2.5 rounded-xl bg-[#111827] hover:bg-[#18233a] hud-border hover:border-cyan-500/40 transition-colors flex items-center justify-between gap-3 group cursor-pointer" data-action="open-detail" data-media-id="${mediaId}">
        <div class="flex items-center gap-2.5 min-w-0">
          <img src="${cover}" alt="${title}" class="w-9 h-12 rounded-lg object-cover flex-shrink-0 bg-[#090d16] hud-border">
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-semibold text-slate-200 truncate group-hover:text-cyan-300 transition-colors">${title}</span>
            <span class="text-[11px] font-mono text-slate-400">Episode ${ep}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-cyan-950/80 border border-cyan-500/20 text-cyan-300">${countdown}</span>
          <button data-action="quick-add" data-media-id="${mediaId}" data-media-title="${title}" class="px-2 py-1 rounded bg-[#1c2742] hover:bg-cyan-500 hover:text-obsidian-950 text-slate-300 text-[10px] font-mono transition-colors cursor-pointer" title="Sync Tracking">+ AutoSync</button>
        </div>
      </div>
    `;
  }

  function renderSeasonalItemHtml(m, theme = 'dark') {
    if (!m) return '';
    const title = escapeHtml(getAnimeTitle(m));
    const cover = escapeHtml(getCoverImage(m));
    const score = escapeHtml(m.averageScore || m.meanScore || '—');
    const format = escapeHtml(m.format || 'TV');
    const eps = escapeHtml(m.episodes ? `${m.episodes} eps` : 'TBA');
    const mediaId = Number(m.id) || 0;

    if (theme === 'light') {
      return `
        <div class="p-2 rounded-lg bg-editorial-slate50 hover:bg-editorial-slate100 border border-editorial-slate200 flex items-center justify-between gap-2.5 transition-colors group cursor-pointer" data-action="open-detail" data-media-id="${mediaId}">
          <div class="flex items-center gap-2.5 min-w-0">
            <img src="${cover}" alt="${title}" class="w-8 h-11 rounded-md object-cover flex-shrink-0 bg-white border border-editorial-slate200">
            <div class="flex flex-col min-w-0">
              <span class="text-xs font-semibold text-editorial-slate900 truncate group-hover:text-editorial-crimson transition-colors">${title}</span>
              <span class="text-[10px] font-mono text-editorial-slate500">${format} • ${eps}</span>
            </div>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <span class="text-[10px] font-mono text-editorial-crimson font-bold">★ ${score}%</span>
            <button data-action="quick-add" data-media-id="${mediaId}" data-media-title="${title}" class="p-1 rounded bg-white hover:bg-editorial-slate900 hover:text-white border border-editorial-slate200 text-editorial-slate700 text-xs transition-colors cursor-pointer" title="Bookmark / Add to List">
              <i class="fa-solid fa-plus"></i>
            </button>
          </div>
        </div>
      `;
    }

    return `
      <div class="p-2 rounded-xl bg-[#111827] hover:bg-[#18233a] hud-border flex items-center justify-between gap-2.5 transition-colors group cursor-pointer" data-action="open-detail" data-media-id="${mediaId}">
        <div class="flex items-center gap-2.5 min-w-0">
          <img src="${cover}" alt="${title}" class="w-8 h-11 rounded-lg object-cover flex-shrink-0 bg-[#090d16] hud-border">
          <div class="flex flex-col min-w-0">
            <span class="text-xs font-semibold text-slate-200 truncate group-hover:text-cyan-300 transition-colors">${title}</span>
            <span class="text-[10px] font-mono text-slate-400">${format} • ${eps}</span>
          </div>
        </div>
        <div class="flex items-center gap-2 flex-shrink-0">
          <span class="text-[10px] font-mono text-amber-400 font-bold">★ ${score}%</span>
          <button data-action="quick-add" data-media-id="${mediaId}" data-media-title="${title}" class="p-1 rounded bg-[#1c2742] hover:bg-cyan-500 hover:text-obsidian-950 text-slate-300 text-xs transition-colors cursor-pointer" title="Bookmark / Add to List">
            <i class="fa-solid fa-plus"></i>
          </button>
        </div>
      </div>
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
              <h3 class="font-bold text-sm text-slate-900 dark:text-white truncate cursor-pointer hover:text-cyan-400 transition-colors" data-action="open-detail" data-media-id="${id}">${title}</h3>
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
            <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${title}</span>
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
          <span class="font-bold text-slate-800 dark:text-slate-100 truncate">${title}</span>
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
    const saved = (typeof localStorage !== 'undefined' && localStorage.getItem('theme')) || 'dark';
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
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('theme', state.theme);
    }
    if (state.activeTab === 'discover') {
      renderDiscover();
      renderAiringRadar();
      renderSeasonalChart();
    }
  }

  // ==============================================================
  // NAVIGATION & TAB SYSTEM (N4: Increments tabToken)
  // ==============================================================
  function switchTab(tabName) {
    if (!tabName || typeof document === 'undefined') return;
    state.activeTab = tabName;
    tabToken++;

    // 1. Update Dark Rail navigation buttons
    document.querySelectorAll('.dark-nav-tab').forEach(btn => {
      const isTarget = btn.dataset.tab === tabName;
      if (isTarget) {
        btn.className = 'nav-tab dark-nav-tab flex items-center gap-3 px-3 py-2.5 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/25 font-medium transition-all group cursor-pointer text-left w-full';
        const dot = btn.querySelector('.badge-glow');
        if (dot) dot.classList.remove('hidden');
      } else {
        btn.className = 'nav-tab dark-nav-tab flex items-center gap-3 px-3 py-2.5 rounded-xl text-slate-400 hover:text-slate-100 hover:bg-[#151f33] font-medium transition-all group cursor-pointer text-left w-full';
        const dot = btn.querySelector('.badge-glow');
        if (dot) dot.classList.add('hidden');
      }
    });

    // 2. Update Light Ribbon navigation buttons
    document.querySelectorAll('.light-nav-tab').forEach(btn => {
      const isTarget = btn.dataset.tab === tabName;
      if (isTarget) {
        btn.className = 'nav-tab light-nav-tab px-2.5 sm:px-3 py-1.5 text-xs font-bold text-editorial-crimson border-b-2 border-editorial-crimson tracking-wide flex items-center gap-1.5 flex-shrink-0 cursor-pointer transition-colors';
      } else {
        btn.className = 'nav-tab light-nav-tab px-2.5 sm:px-3 py-1.5 text-xs font-medium text-editorial-slate600 hover:text-editorial-slate900 border-b-2 border-transparent transition-colors flex-shrink-0 cursor-pointer';
      }
    });

    // 3. Update Mobile Drawer buttons
    document.querySelectorAll('.mobile-nav-tab').forEach(btn => {
      const isTarget = btn.dataset.tab === tabName;
      if (isTarget) {
        btn.classList.add('text-cyan-400', 'bg-cyan-500/10', 'text-editorial-crimson', 'bg-rose-50');
      } else {
        btn.classList.remove('text-cyan-400', 'bg-cyan-500/10', 'text-editorial-crimson', 'bg-rose-50');
      }
    });

    // 4. Update breadcrumb
    const breadcrumbTitles = {
      discover: 'Discover Matrix',
      watching: 'Watching Cockpit',
      lists: 'AniList Collection',
      search: 'Global Search',
      social: 'Social Hub',
      stats: 'Analytics & Stats',
      history: 'Download History',
      logs: 'System Logs',
      settings: 'Config & Preferences'
    };
    const darkBreadcrumb = document.getElementById('dark-breadcrumb-tab');
    if (darkBreadcrumb) {
      darkBreadcrumb.textContent = breadcrumbTitles[tabName] || tabName.toUpperCase();
    }

    // 5. Toggle panel visibility
    document.querySelectorAll('.view-panel').forEach(panel => {
      panel.classList.toggle('hidden', panel.id !== `${tabName}-panel`);
    });

    // 6. Close mobile menu drawers
    document.getElementById('mobile-menu')?.classList.add('hidden');
    document.getElementById('dark-mobile-menu')?.classList.add('hidden');

    // 7. Load Tab Data
    switch (tabName) {
      case 'discover':
        loadDiscover();
        break;
      case 'watching':
        loadWatching();
        break;
      case 'lists':
        loadUserListsData();
        break;
      case 'search':
        if (state.searchResults.length === 0 && !state.searchQuery) {
          performSearch();
        }
        break;
      case 'social':
        loadSocialFeed();
        break;
      case 'stats':
        loadUserStats();
        break;
      case 'history':
        loadDownloadHistory();
        break;
      case 'logs':
        loadLogs();
        break;
      case 'settings':
        loadSettingsConfig();
        break;
    }
  }

  // ==============================================================
  // DISCOVER MATRIX CONTROLLER
  // ==============================================================
  function switchFeed(feedKey) {
    if (!['trending', 'popular', 'top', 'seasonal', 'upcoming'].includes(feedKey)) return;
    state.discoverFeedKey = feedKey;

    if (typeof document !== 'undefined') {
      // Update Dark HUD Tab Switchers
      document.querySelectorAll('.dark-feed-tab').forEach(btn => {
        const isTarget = btn.id === `dark-tab-${feedKey}`;
        if (isTarget) {
          btn.className = 'dark-feed-tab px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold tracking-wide bg-cyan-500 text-obsidian-950 shadow-sm transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer';
        } else {
          btn.className = 'dark-feed-tab px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-semibold tracking-wide text-slate-400 hover:text-slate-100 hover:bg-[#151f33] transition-all flex items-center gap-1.5 flex-shrink-0 cursor-pointer';
        }
      });

      // Update Light Editorial Feed Buttons
      document.querySelectorAll('.light-feed-btn').forEach(btn => {
        const isTarget = btn.id === `light-feed-${feedKey}`;
        if (isTarget) {
          btn.className = 'light-feed-btn w-full px-3 py-2 rounded-lg text-left text-xs font-bold bg-editorial-slate900 text-white flex items-center justify-between transition-all shadow-sm cursor-pointer';
        } else {
          btn.className = 'light-feed-btn w-full px-3 py-2 rounded-lg text-left text-xs font-semibold text-editorial-slate700 hover:bg-editorial-slate100 flex items-center justify-between transition-all cursor-pointer';
        }
      });
    }

    renderDiscover();
    fetchFeedData(feedKey);
  }

  function filterDiscoverFormat(format) {
    state.discoverFormatFilter = format || 'ALL';
    if (typeof document !== 'undefined') {
      const darkSelect = document.getElementById('dark-format-filter');
      const lightSelect = document.getElementById('light-format-select');
      if (darkSelect) darkSelect.value = format;
      if (lightSelect) lightSelect.value = format;
    }
    renderDiscover();
  }

  // N1: Real Season Switcher Controller
  function setDiscoverSeason(season) {
    state.discoverSeason = season;
    if (typeof document !== 'undefined') {
      ['SPRING', 'SUMMER', 'FALL', 'WINTER'].forEach(s => {
        const dBtn = document.getElementById(`dark-season-${s}`);
        if (dBtn) {
          if (s === season) {
            dBtn.className = 'dark-season-btn py-1.5 rounded-lg text-xs font-semibold bg-cyan-500 text-obsidian-950 shadow-sm transition-all text-center cursor-pointer';
          } else {
            dBtn.className = 'dark-season-btn py-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white transition-all text-center cursor-pointer';
          }
        }
        const lBtn = document.getElementById(`light-season-${s}`);
        if (lBtn) {
          if (s === season) {
            lBtn.className = 'light-season-btn py-1 rounded text-xs font-bold bg-white text-editorial-slate900 shadow-sm transition-all text-center cursor-pointer';
          } else {
            lBtn.className = 'light-season-btn py-1 rounded text-xs font-semibold text-editorial-slate600 hover:text-editorial-slate900 transition-all text-center cursor-pointer';
          }
        }
      });

      const darkYearTag = document.getElementById('dark-seasonal-year-tag');
      if (darkYearTag) darkYearTag.textContent = `${state.discoverSeasonYear} ${season}`;
      const lightYearTag = document.getElementById('light-seasonal-year-tag');
      if (lightYearTag) lightYearTag.textContent = `${state.discoverSeasonYear} ${season}`;
    }

    fetchSeasonalChartData();
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
      ['Airing', 'Upcoming', 'TBA', 'Archive'].forEach(st => {
        const dBtn = document.getElementById(`dark-subtab-${st}`);
        if (dBtn) {
          if (st === subtab) {
            dBtn.className = 'dark-status-btn px-2.5 py-1 rounded-md text-[11px] font-semibold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex-shrink-0 cursor-pointer';
          } else {
            dBtn.className = 'dark-status-btn px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-400 hover:text-slate-200 flex-shrink-0 cursor-pointer';
          }
        }
        const lBtn = document.getElementById(`light-subtab-${st}`);
        if (lBtn) {
          if (st === subtab) {
            lBtn.className = 'light-status-btn px-2.5 py-1 rounded text-[11px] font-bold bg-editorial-slate900 text-white flex-shrink-0 cursor-pointer';
          } else {
            lBtn.className = 'light-status-btn px-2.5 py-1 rounded text-[11px] font-medium text-editorial-slate600 hover:text-editorial-slate900 flex-shrink-0 cursor-pointer';
          }
        }
      });
    }
    fetchSeasonalChartData();
  }

  // N3: Hide My List Toggle
  function toggleHideMyList(checked) {
    state.hideOnMyList = Boolean(checked);
    if (typeof document !== 'undefined') {
      const dChk = document.getElementById('dark-hide-my-list');
      const lChk = document.getElementById('light-hide-my-list');
      if (dChk) dChk.checked = state.hideOnMyList;
      if (lChk) lChk.checked = state.hideOnMyList;
    }
    renderSeasonalChart();
  }

  // Discover feed fetch with N4 stale-tab guard
  async function fetchFeedData(feedKey) {
    const token = tabToken;
    try {
      const res = await API.getDiscover(feedKey);
      if (isStaleTab(token)) return;
      if (res && res.media && res.media.length > 0) {
        state.discoverFeeds[feedKey] = res.media;
      }
    } catch (err) {}
    if (!isStaleTab(token) && state.activeTab === 'discover') {
      renderDiscover();
    }
  }

  // Airing radar fetch with N4 stale-tab guard
  async function fetchAiringRadarData() {
    const token = tabToken;
    try {
      const res = await API.getAiringToday(168);
      if (isStaleTab(token)) return;
      if (res && res.schedules && res.schedules.length > 0) {
        state.airingRadar = res.schedules;
      }
    } catch (err) {}
    if (!isStaleTab(token) && state.activeTab === 'discover') {
      renderAiringRadar();
    }
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
    const token = tabToken;
    const season = state.discoverSeason || 'SUMMER';
    const year = parseInt(state.discoverSeasonYear || 2026, 10);
    const subtab = state.discoverChartTab || 'Airing';
    const status = SUBTAB_STATUS_MAP[subtab] || 'RELEASING';
    const cacheKey = `${season}_${year}_${status}`;

    // If cached, use immediately
    if (seasonalCache[cacheKey]) {
      state.seasonalChart = seasonalCache[cacheKey];
      renderSeasonalChart();
      return;
    }

    // Show loading state
    if (typeof document !== 'undefined') {
      const darkChart = document.getElementById('dark-seasonal-chart');
      if (darkChart) {
        darkChart.innerHTML = `
          <div class="py-12 text-center text-slate-400 font-mono text-xs">
            <i class="fa-solid fa-spinner fa-spin text-xl text-cyan-400 mb-2"></i>
            <p>Loading ${escapeHtml(season)} ${escapeHtml(year)} chart...</p>
          </div>
        `;
      }
      const lightChart = document.getElementById('light-seasonal-list');
      if (lightChart) {
        lightChart.innerHTML = `
          <div class="py-12 text-center text-editorial-slate400 font-mono text-xs">
            <i class="fa-solid fa-spinner fa-spin text-xl text-editorial-crimson mb-2"></i>
            <p>Loading ${escapeHtml(season)} ${escapeHtml(year)} chart...</p>
          </div>
        `;
      }
    }

    try {
      const data = await queryAniList(SEASONAL_CHART_QUERY, {
        season,
        seasonYear: year,
        status
      });

      if (isStaleTab(token)) return;

      const items = data?.Page?.media || [];
      seasonalCache[cacheKey] = items;

      if (state.discoverSeason === season && state.discoverChartTab === subtab) {
        state.seasonalChart = items;
        renderSeasonalChart();
      }
    } catch (err) {
      if (isStaleTab(token)) return;
      // On fetch error: show error message or honest empty state (never fallback data for filter empty)
      renderSeasonalChart(err.message);
    }
  }

  async function loadDiscover() {
    renderDiscover();
    renderAiringRadar();
    renderSeasonalChart();

    await Promise.allSettled([
      fetchFeedData(state.discoverFeedKey),
      fetchAiringRadarData(),
      fetchSeasonalChartData()
    ]);
  }

  // Render Discover Hero Spotlight & Grids
  function renderDiscover() {
    if (typeof document === 'undefined') return;
    const feedKey = state.discoverFeedKey;
    let list = state.discoverFeeds[feedKey] || FALLBACK_DATA[feedKey] || [];

    // Filter by Format
    if (state.discoverFormatFilter !== 'ALL') {
      list = list.filter(m => m.format === state.discoverFormatFilter);
    }

    // Filter by Search Query
    if (state.discoverSearchTerm) {
      list = list.filter(m => {
        const title = getAnimeTitle(m).toLowerCase();
        return title.includes(state.discoverSearchTerm);
      });
    }

    // Update Counts & Badges
    const feedNames = {
      trending: 'Trending Pulse',
      popular: 'Most Popular',
      top: 'Top Rated',
      seasonal: `Season ${state.discoverSeasonYear || 2026}`,
      upcoming: 'Upcoming Next'
    };

    ['trending', 'popular', 'top', 'seasonal', 'upcoming'].forEach(k => {
      const count = (state.discoverFeeds[k] || FALLBACK_DATA[k] || []).length || 12;
      const dBadge = document.getElementById(`dark-badge-${k}`);
      if (dBadge) dBadge.textContent = count;
      const lBadge = document.getElementById(`light-badge-${k}`);
      if (lBadge) lBadge.textContent = count;
    });

    const dCount = document.getElementById('dark-feed-count');
    if (dCount) dCount.textContent = `${list.length} Items`;
    const lCount = document.getElementById('light-feed-count');
    if (lCount) lCount.textContent = `${list.length} Records`;
    const lTitle = document.getElementById('light-feed-title');
    if (lTitle) lTitle.textContent = feedNames[feedKey] || 'Catalog';

    // Render Spotlight Hero Banner
    const heroMedia = list[0] || FALLBACK_DATA.trending[0];
    if (heroMedia) {
      state.spotlightMedia = heroMedia;
      const title = getAnimeTitle(heroMedia);
      const cover = getCoverImage(heroMedia);
      const score = heroMedia.averageScore || heroMedia.meanScore || 88;
      const format = heroMedia.format || 'TV';
      const eps = heroMedia.episodes ? `${heroMedia.episodes} Episodes` : 'Releasing';
      const desc = sanitizeHtml(heroMedia.description) || 'Featured masterpiece in the current catalog collection.';

      // Dark Hero
      const dCover = document.getElementById('dark-hero-cover');
      if (dCover) dCover.src = cover;
      const dTitle = document.getElementById('dark-hero-title');
      if (dTitle) dTitle.textContent = title;
      const dDesc = document.getElementById('dark-hero-desc');
      if (dDesc) dDesc.textContent = desc;
      const dScore = document.getElementById('dark-hero-score');
      if (dScore) dScore.textContent = `★ ${score}%`;
      const dMeta = document.getElementById('dark-hero-meta');
      if (dMeta) dMeta.textContent = `${format} • ${eps}`;

      const dBtnAdd = document.getElementById('dark-hero-btn-add');
      if (dBtnAdd) {
        dBtnAdd.onclick = () => quickAddWatching(heroMedia.id, title);
      }
      const dBtnInsp = document.getElementById('dark-hero-btn-inspect');
      if (dBtnInsp) {
        dBtnInsp.onclick = () => openMediaDetail(heroMedia.id);
      }

      // Light Hero
      const lCover = document.getElementById('light-hero-cover');
      if (lCover) lCover.src = cover;
      const lTitleEl = document.getElementById('light-hero-title');
      if (lTitleEl) lTitleEl.textContent = title;
      const lDesc = document.getElementById('light-hero-desc');
      if (lDesc) lDesc.textContent = desc;
      const lScore = document.getElementById('light-hero-score');
      if (lScore) lScore.textContent = `★ ${score}% Score`;
      const lMeta = document.getElementById('light-hero-meta');
      if (lMeta) lMeta.textContent = `${format} • ${eps}`;

      const lBtnAdd = document.getElementById('light-hero-btn-add');
      if (lBtnAdd) {
        lBtnAdd.onclick = () => quickAddWatching(heroMedia.id, title);
      }
      const lBtnInsp = document.getElementById('light-hero-btn-inspect');
      if (lBtnInsp) {
        lBtnInsp.onclick = () => openMediaDetail(heroMedia.id);
      }
    }

    // Render Dark Discover Grid
    const darkGrid = document.getElementById('dark-discover-grid');
    if (darkGrid) {
      if (list.length === 0) {
        darkGrid.innerHTML = `
          <div class="col-span-full py-16 text-center text-slate-400 font-mono text-xs">
            <i class="fa-solid fa-magnifying-glass text-2xl text-cyan-400/50 mb-2"></i>
            <p>No titles matched the current filter criteria.</p>
          </div>
        `;
      } else {
        darkGrid.innerHTML = list.map(m => renderDiscoverCardHtml(m, 'dark')).join('');
      }
    }

    // Render Light Discover Grid
    const lightGrid = document.getElementById('light-discover-grid');
    if (lightGrid) {
      if (list.length === 0) {
        lightGrid.innerHTML = `
          <div class="col-span-full py-16 text-center text-slate-400 font-mono text-xs">
            <i class="fa-solid fa-magnifying-glass text-2xl text-rose-400 mb-2"></i>
            <p>No records matched your filter selection.</p>
          </div>
        `;
      } else {
        lightGrid.innerHTML = list.map(m => renderDiscoverCardHtml(m, 'light')).join('');
      }
    }
  }

  // Render Airing Radar Timeline
  function renderAiringRadar() {
    if (typeof document === 'undefined') return;
    const schedules = state.airingRadar.length > 0 ? state.airingRadar : FALLBACK_DATA.trending;

    const darkRadar = document.getElementById('dark-airing-radar');
    if (darkRadar) {
      darkRadar.innerHTML = schedules.slice(0, 10).map(item => renderAiringRadarItemHtml(item, 'dark')).join('');
    }

    const lightRadar = document.getElementById('light-airing-radar');
    if (lightRadar) {
      lightRadar.innerHTML = schedules.slice(0, 10).map(item => renderAiringRadarItemHtml(item, 'light')).join('');
    }
  }

  // Render Seasonal Chart Hub & Workspace (N1, N2, N3: Honest Empty State, TBA Filter, Hide-My-List)
  function renderSeasonalChart(errorMessage = null) {
    if (typeof document === 'undefined') return;
    const darkChart = document.getElementById('dark-seasonal-chart');
    const lightChart = document.getElementById('light-seasonal-list');
    if (!darkChart && !lightChart) return;

    let items = Array.isArray(state.seasonalChart) ? [...state.seasonalChart] : [];

    // Filter by Subtab (Airing, Upcoming, TBA, Archive)
    if (state.discoverChartTab === 'Upcoming') {
      items = items.filter(m => Boolean(m.nextAiringEpisode));
    } else if (state.discoverChartTab === 'TBA') {
      items = items.filter(m => !m.nextAiringEpisode);
    }

    // Filter by Hide My List (N3)
    if (state.hideOnMyList) {
      const onListIds = new Set(state.animeList.map(a => Number(a.mediaId || a.id)));
      items = items.filter(m => {
        const id = Number(m.id);
        const onWatch = onListIds.has(id);
        const onAniList = Boolean(state.listEntriesByMedia[id]) || Boolean(m.mediaListEntry);
        return !onWatch && !onAniList;
      });
    }

    // N3: Honest empty state message — NEVER re-insert fallback data on empty filter
    if (items.length === 0) {
      const emptyMsg = errorMessage
        ? `Failed to load seasonal data: ${escapeHtml(errorMessage)}`
        : 'No titles for this season/filter.';

      const emptyDark = `
        <div class="col-span-full py-12 text-center text-slate-400 font-mono text-xs">
          <i class="fa-solid fa-calendar-xmark text-2xl text-cyan-400/50 mb-2"></i>
          <p>${emptyMsg}</p>
        </div>
      `;
      const emptyLight = `
        <div class="col-span-full py-12 text-center text-editorial-slate500 font-mono text-xs">
          <i class="fa-solid fa-calendar-xmark text-2xl text-editorial-crimson/50 mb-2"></i>
          <p>${emptyMsg}</p>
        </div>
      `;
      if (darkChart) darkChart.innerHTML = emptyDark;
      if (lightChart) lightChart.innerHTML = emptyLight;
      return;
    }

    // Dark Seasonal Chart
    if (darkChart) {
      darkChart.innerHTML = items.slice(0, 15).map(m => renderSeasonalItemHtml(m, 'dark')).join('');
    }

    // Light Seasonal Chart
    if (lightChart) {
      lightChart.innerHTML = items.slice(0, 15).map(m => renderSeasonalItemHtml(m, 'light')).join('');
    }
  }

  // ==============================================================
  // MEDIA DETAIL ART SHEET MODAL (B1: Fully Escaped)
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
        if (res.ok) media = await res.json();
      }

      if (!media) {
        const allItems = [...FALLBACK_DATA.trending, ...FALLBACK_DATA.popular, ...FALLBACK_DATA.top, ...FALLBACK_DATA.seasonal];
        media = allItems.find(x => x.id === parseInt(mediaId, 10)) || FALLBACK_DATA.trending[0];
      }

      state.activeMediaDetail = media;

      const title = escapeHtml(getAnimeTitle(media));
      const cover = escapeHtml(getCoverImage(media));
      const banner = escapeHtml(media.bannerImage || cover);
      const score = escapeHtml(media.averageScore || media.meanScore || '—');
      const desc = sanitizeHtml(media.description) || 'Rich metadata from AniList GraphQL directory.';
      const studio = escapeHtml(media.studios?.nodes?.[0]?.name || 'Animation Studio');
      const genres = (media.genres || ['Action', 'Fantasy']).map(g => `<span class="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[11px] font-semibold text-slate-700 dark:text-slate-300">${escapeHtml(g)}</span>`).join('');
      const listEntry = media.mediaListEntry || state.listEntriesByMedia[media.id];
      const entryStatus = listEntry ? escapeHtml(listEntry.status) : '';
      const format = escapeHtml(media.format || 'TV');
      const eps = escapeHtml(media.episodes ? `${media.episodes} Episodes` : 'Releasing');
      const seasonStr = escapeHtml(`${media.season || ''} ${media.seasonYear || ''}`.trim());
      const safeId = Number(media.id) || 0;

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

          <!-- Genres -->
          <div class="flex flex-wrap gap-1.5">
            ${genres}
          </div>

          <!-- Synopsis -->
          <div class="space-y-2">
            <h3 class="text-xs font-bold font-mono text-slate-400 uppercase tracking-wider">Synopsis</h3>
            <p class="text-xs sm:text-sm text-slate-700 dark:text-slate-300 leading-relaxed max-h-60 overflow-y-auto custom-scrollbar pr-2">${desc}</p>
          </div>
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
      const anime = await API.getAnimeList();
      if (isStaleTab(token)) return;
      state.animeList = anime || [];

      // Update badge count
      const count = state.animeList.length;
      const darkBadge = document.getElementById('dark-watching-badge');
      if (darkBadge) darkBadge.textContent = count;
      const lightBadge = document.getElementById('light-watching-badge');
      if (lightBadge) lightBadge.textContent = count;

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

      if (items.length === 0) {
        const res = await fetch(`/api/anilist/search?query=${encodeURIComponent(term || '')}&type=${entity === 'MANGA' ? 'MANGA' : 'ANIME'}`);
        if (res.ok) {
          const json = await res.json();
          items = json.media || json.results || [];
        }
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
    document.querySelectorAll('.dark-nav-tab, .light-nav-tab').forEach(btn => {
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
    document.querySelectorAll('#theme-toggle-dark, #theme-toggle-light, .theme-toggle-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        toggleTheme();
      });
    });

    // Hamburger menus
    document.getElementById('light-hamburger-btn')?.addEventListener('click', () => {
      document.getElementById('mobile-menu')?.classList.toggle('hidden');
    });
    document.getElementById('dark-mobile-menu-btn')?.addEventListener('click', () => {
      document.getElementById('dark-mobile-menu')?.classList.toggle('hidden');
    });

    // Global Search Inputs
    function setupGlobalSearch(inputEl) {
      if (!inputEl) return;
      inputEl.addEventListener('input', (e) => {
        const term = e.target.value.toLowerCase().trim();
        if (state.activeTab === 'discover') {
          state.discoverSearchTerm = term;
          renderDiscover();
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
    setupGlobalSearch(document.getElementById('dark-global-search'));
    setupGlobalSearch(document.getElementById('light-global-search'));

    // Command-K / Ctrl-K shortcut
    window.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const isDark = document.documentElement.classList.contains('dark');
        const darkSearch = document.getElementById('dark-global-search');
        const lightSearch = document.getElementById('light-global-search');
        if (isDark && darkSearch) {
          darkSearch.focus();
          darkSearch.select();
        } else if (!isDark && lightSearch) {
          lightSearch.focus();
          lightSearch.select();
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
        const isDark = document.documentElement.classList.contains('dark');
        const panel = isDark ? document.getElementById('notif-dropdown-dark') : document.getElementById('notif-dropdown-light');
        panel?.classList.toggle('hidden');
      });
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.notif-toggle-btn, .notif-dropdown-panel')) {
        document.getElementById('notif-dropdown-dark')?.classList.add('hidden');
        document.getElementById('notif-dropdown-light')?.classList.add('hidden');
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
    getAnimeTitle,
    formatTitle,
    getCoverImage,
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
