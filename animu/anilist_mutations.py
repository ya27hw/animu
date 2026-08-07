"""
AniList GraphQL mutations.

Provides an authenticated client surface for every AniList mutation the
backend needs (media-list management, activity, favourites, reviews,
recommendations, user preferences).

Design / security rules
-----------------------
- Every mutation runs through the shared ``execute_graphql`` primitive
  with ``require_auth=True``.  This is non-negotiable: mutations must
  *fail closed* — they never drop the bearer on 400/401 and never retry
  without authentication.  (The read fallback in ``execute_graphql`` only
  applies when ``require_auth=False``.)
- A clear error is raised when no token is available, so callers can
  distinguish "needs auth" from an API failure.
- The bearer token is never logged, interpolated into query text, or
  present in returned payloads (the token only lives in the
  ``Authorization`` header, which ``execute_graphql`` manages internally).
- Tests mock every network call — no real AniList mutations are performed.
"""

from typing import Any, Dict, List, Optional

from .anilist_auth import execute_graphql, auth
from .config import get_config  # imported for parity with anilist.py; token checks go via auth.is_token_present()


def _run_mutation(mutation: str, variables: Dict[str, Any]) -> Dict[str, Any]:
    """Run an authenticated AniList mutation and normalise the result.

    Delegates to the shared ``execute_graphql(require_auth=True)`` which
    enforces fail-closed behaviour: if no token is configured the call
    returns ``{"errors": [...]}`` without hitting the network, and a 400/401
    is returned as-is rather than retried anonymously.
    """
    result = execute_graphql(mutation, variables, require_auth=True)
    if result is None:
        return {}
    return result


def _require_token() -> None:
    """Raise a clear error if no bearer token is configured.

    This lets higher-level callers surface a friendly "please authenticate"
    UX rather than silently getting a fail-closed error dict.
    """
    if not auth.is_token_present():
        raise RuntimeError(
            "AniList access token is not configured. "
            "Please authenticate via /api/anilist/auth/url."
        )


class AniListMutations:
    """Thin, typed wrapper over the AniList GraphQL mutation surface.

    All methods return a dict mirroring the shape of the GraphQL response
    ``data`` for that mutation (keyed by the mutation field name), or an
    ``{"errors": [...]}`` dict on failure.
    """

    def __init__(self):
        pass

    # ------------------------------------------------------------------
    # Media list entries
    # ------------------------------------------------------------------

    def save_media_list_entry(
        self,
        media_id: int,
        status: Optional[str] = None,
        score: Optional[float] = None,
        score_raw: Optional[int] = None,
        progress: Optional[int] = None,
        progress_volumes: Optional[int] = None,
        repeat: Optional[int] = None,
        priority: Optional[int] = None,
        notes: Optional[str] = None,
        private: Optional[bool] = None,
        hidden_from_status_lists: Optional[bool] = None,
        custom_lists: Optional[List[str]] = None,
        advanced_scores: Optional[List[float]] = None,
        started_at: Optional[Dict[str, int]] = None,
        completed_at: Optional[Dict[str, int]] = None,
        entry_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create or update a media list entry.

        The full save payload is supported including ``customLists``,
        ``advancedScores`` and ``scoreRaw`` per the AniList spec.
        """
        _require_token()
        mutation = """
        mutation SaveMediaListEntry($mediaId: Int, $status: MediaListStatus,
          $score: Float, $scoreRaw: Int, $progress: Int, $progressVolumes: Int,
          $repeat: Int, $priority: Int, $notes: String, $private: Boolean,
          $hiddenFromStatusLists: Boolean, $customLists: [String],
          $advancedScores: [Float], $startedAt: FuzzyDateInput,
          $completedAt: FuzzyDateInput, $id: Int) {
          SaveMediaListEntry(
            id: $id, mediaId: $mediaId, status: $status, score: $score,
            scoreRaw: $scoreRaw, progress: $progress,
            progressVolumes: $progressVolumes, repeat: $repeat,
            priority: $priority, notes: $notes, private: $private,
            hiddenFromStatusLists: $hiddenFromStatusLists,
            customLists: $customLists, advancedScores: $advancedScores,
            startedAt: $startedAt, completedAt: $completedAt
          ) {
            id
            mediaId
            status
            score
            scoreRaw
            progress
            priority
            notes
            private
            hiddenFromStatusLists
            customLists
          }
        }
        """
        variables: Dict[str, Any] = {"mediaId": media_id}
        if entry_id is not None:
            variables["id"] = entry_id
        if status is not None:
            variables["status"] = status
        if score is not None:
            variables["score"] = score
        if score_raw is not None:
            variables["scoreRaw"] = score_raw
        if progress is not None:
            variables["progress"] = progress
        if progress_volumes is not None:
            variables["progressVolumes"] = progress_volumes
        if repeat is not None:
            variables["repeat"] = repeat
        if priority is not None:
            variables["priority"] = priority
        if notes is not None:
            variables["notes"] = notes
        if private is not None:
            variables["private"] = private
        if hidden_from_status_lists is not None:
            variables["hiddenFromStatusLists"] = hidden_from_status_lists
        if custom_lists is not None:
            variables["customLists"] = custom_lists
        if advanced_scores is not None:
            variables["advancedScores"] = advanced_scores
        if started_at is not None:
            variables["startedAt"] = started_at
        if completed_at is not None:
            variables["completedAt"] = completed_at

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def update_media_list_entries(
        self,
        ids: List[int],
        status: Optional[str] = None,
        score: Optional[float] = None,
        score_raw: Optional[int] = None,
        progress: Optional[int] = None,
        progress_volumes: Optional[int] = None,
        repeat: Optional[int] = None,
        priority: Optional[int] = None,
        notes: Optional[str] = None,
        private: Optional[bool] = None,
        hidden_from_status_lists: Optional[bool] = None,
        custom_lists: Optional[List[str]] = None,
        advanced_scores: Optional[List[float]] = None,
        started_at: Optional[Dict[str, int]] = None,
        completed_at: Optional[Dict[str, int]] = None,
    ) -> Dict[str, Any]:
        """Update multiple media list entries to the same values."""
        _require_token()
        mutation = """
        mutation UpdateMediaListEntries($ids: [Int], $status: MediaListStatus,
          $score: Float, $scoreRaw: Int, $progress: Int, $progressVolumes: Int,
          $repeat: Int, $priority: Int, $notes: String, $private: Boolean,
          $hiddenFromStatusLists: Boolean, $customLists: [String],
          $advancedScores: [Float], $startedAt: FuzzyDateInput,
          $completedAt: FuzzyDateInput) {
          UpdateMediaListEntries(
            ids: $ids, status: $status, score: $score, scoreRaw: $scoreRaw,
            progress: $progress, progressVolumes: $progressVolumes,
            repeat: $repeat, priority: $priority, notes: $notes,
            private: $private, hiddenFromStatusLists: $hiddenFromStatusLists,
            customLists: $customLists, advancedScores: $advancedScores,
            startedAt: $startedAt, completedAt: $completedAt
          ) {
            id
            mediaId
            status
            progress
            score
          }
        }
        """
        variables: Dict[str, Any] = {"ids": ids}
        if status is not None:
            variables["status"] = status
        if score is not None:
            variables["score"] = score
        if score_raw is not None:
            variables["scoreRaw"] = score_raw
        if progress is not None:
            variables["progress"] = progress
        if progress_volumes is not None:
            variables["progressVolumes"] = progress_volumes
        if repeat is not None:
            variables["repeat"] = repeat
        if priority is not None:
            variables["priority"] = priority
        if notes is not None:
            variables["notes"] = notes
        if private is not None:
            variables["private"] = private
        if hidden_from_status_lists is not None:
            variables["hiddenFromStatusLists"] = hidden_from_status_lists
        if custom_lists is not None:
            variables["customLists"] = custom_lists
        if advanced_scores is not None:
            variables["advancedScores"] = advanced_scores
        if started_at is not None:
            variables["startedAt"] = started_at
        if completed_at is not None:
            variables["completedAt"] = completed_at

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def delete_media_list_entry(self, entry_id: int) -> Dict[str, Any]:
        """Delete a single media list entry by its id."""
        _require_token()
        mutation = """
        mutation DeleteMediaListEntry($id: Int) {
          DeleteMediaListEntry(id: $id) {
            id
          }
        }
        """
        resp = _run_mutation(mutation, {"id": entry_id})
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def delete_custom_list(self, custom_list: str, media_type: str = "ANIME") -> Dict[str, Any]:
        """Delete a custom list by name for the given media type."""
        _require_token()
        mutation = """
        mutation DeleteCustomList($customList: String, $type: MediaType) {
          DeleteCustomList(customList: $customList, type: $type) {
            id
          }
        }
        """
        resp = _run_mutation(mutation, {"customList": custom_list, "type": media_type})
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    # ------------------------------------------------------------------
    # Activity
    # ------------------------------------------------------------------

    def save_text_activity(
        self,
        text: str,
        activity_id: Optional[int] = None,
        locked: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Create or update text activity for the authenticated user."""
        _require_token()
        mutation = """
        mutation SaveTextActivity($text: String, $id: Int, $locked: Boolean) {
          SaveTextActivity(id: $id, text: $text, locked: $locked) {
            id
            text
            locked
            ... on TextActivity {
              userId
            }
          }
        }
        """
        variables: Dict[str, Any] = {"text": text}
        if activity_id is not None:
            variables["id"] = activity_id
        if locked is not None:
            variables["locked"] = locked

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def save_message_activity(
        self,
        message: str,
        recipient_id: int,
        activity_id: Optional[int] = None,
        private: Optional[bool] = None,
        locked: Optional[bool] = None,
        as_mod: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Create or update a message activity."""
        _require_token()
        mutation = """
        mutation SaveMessageActivity($message: String, $recipientId: Int,
          $id: Int, $private: Boolean, $locked: Boolean, $asMod: Boolean) {
          SaveMessageActivity(id: $id, message: $message,
            recipientId: $recipientId, private: $private,
            locked: $locked, asMod: $asMod) {
            id
            message
            private
            ... on MessageActivity {
              recipientId
            }
          }
        }
        """
        variables: Dict[str, Any] = {"message": message, "recipientId": recipient_id}
        if activity_id is not None:
            variables["id"] = activity_id
        if private is not None:
            variables["private"] = private
        if locked is not None:
            variables["locked"] = locked
        if as_mod is not None:
            variables["asMod"] = as_mod

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def save_activity_reply(
        self,
        activity_id: int,
        text: str,
        reply_id: Optional[int] = None,
        as_mod: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """Create or update an activity reply."""
        _require_token()
        mutation = """
        mutation SaveActivityReply($activityId: Int, $text: String,
          $id: Int, $asMod: Boolean) {
          SaveActivityReply(activityId: $activityId, text: $text,
            id: $id, asMod: $asMod) {
            id
            text
            ... on ActivityReply {
              activityId
              userId
            }
          }
        }
        """
        variables: Dict[str, Any] = {"activityId": activity_id, "text": text}
        if reply_id is not None:
            variables["id"] = reply_id
        if as_mod is not None:
            variables["asMod"] = as_mod

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    # ------------------------------------------------------------------
    # Likes, follows, favourites
    # ------------------------------------------------------------------

    def toggle_like(self, likeable_id: int, likeable_type: str = "ACTIVITY") -> Dict[str, Any]:
        """Toggle a like on a likeable type (ACTIVITY, ACTIVITY_REPLY, etc.)."""
        _require_token()
        mutation = """
        mutation ToggleLike($id: Int, $type: LikeableType) {
          ToggleLike(id: $id, type: $type) {
            id
            name
          }
        }
        """
        resp = _run_mutation(
            mutation, {"id": likeable_id, "type": likeable_type}
        )
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def toggle_follow(self, user_id: int) -> Dict[str, Any]:
        """Toggle following/unfollowing a user."""
        _require_token()
        mutation = """
        mutation ToggleFollow($userId: Int) {
          ToggleFollow(userId: $userId) {
            id
            name
          }
        }
        """
        resp = _run_mutation(mutation, {"userId": user_id})
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def toggle_favourite(
        self,
        anime_id: Optional[int] = None,
        manga_id: Optional[int] = None,
        character_id: Optional[int] = None,
        staff_id: Optional[int] = None,
        studio_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Favourite or unfavourite a media/character/staff/studio."""
        _require_token()
        mutation = """
        mutation ToggleFavourite($animeId: Int, $mangaId: Int,
          $characterId: Int, $staffId: Int, $studioId: Int) {
          ToggleFavourite(animeId: $animeId, mangaId: $mangaId,
            characterId: $characterId, staffId: $staffId, studioId: $studioId) {
            anime {
              nodes {
                id
              }
            }
            manga {
              nodes {
                id
              }
            }
            character {
              nodes {
                id
              }
            }
            staff {
              nodes {
                id
              }
            }
            studio {
              nodes {
                id
              }
            }
          }
        }
        """
        variables: Dict[str, Any] = {}
        if anime_id is not None:
            variables["animeId"] = anime_id
        if manga_id is not None:
            variables["mangaId"] = manga_id
        if character_id is not None:
            variables["characterId"] = character_id
        if staff_id is not None:
            variables["staffId"] = staff_id
        if studio_id is not None:
            variables["studioId"] = studio_id

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def update_favourite_order(
        self,
        anime_ids: Optional[List[int]] = None,
        manga_ids: Optional[List[int]] = None,
        character_ids: Optional[List[int]] = None,
        staff_ids: Optional[List[int]] = None,
        studio_ids: Optional[List[int]] = None,
    ) -> Dict[str, Any]:
        """Update the display order of favourites for each media type."""
        _require_token()
        mutation = """
        mutation UpdateFavouriteOrder($animeIds: [Int], $mangaIds: [Int],
          $characterIds: [Int], $staffIds: [Int], $studioIds: [Int]) {
          UpdateFavouriteOrder(animeIds: $animeIds, mangaIds: $mangaIds,
            characterIds: $characterIds, staffIds: $staffIds,
            studioIds: $studioIds) {
            anime {
              nodes {
                id
              }
            }
            manga {
              nodes {
                id
              }
            }
            character {
              nodes {
                id
              }
            }
            staff {
              nodes {
                id
              }
            }
            studio {
              nodes {
                id
              }
            }
          }
        }
        """
        variables: Dict[str, Any] = {}
        if anime_ids is not None:
            variables["animeIds"] = anime_ids
        if manga_ids is not None:
            variables["mangaIds"] = manga_ids
        if character_ids is not None:
            variables["characterIds"] = character_ids
        if staff_ids is not None:
            variables["staffIds"] = staff_ids
        if studio_ids is not None:
            variables["studioIds"] = studio_ids

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    # ------------------------------------------------------------------
    # Reviews & recommendations
    # ------------------------------------------------------------------

    def save_review(
        self,
        media_id: int,
        body: str,
        summary: Optional[str] = None,
        score: Optional[int] = None,
        private: Optional[bool] = None,
        review_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Create or update a review."""
        _require_token()
        mutation = """
        mutation SaveReview($id: Int, $mediaId: Int, $body: String,
          $summary: String, $score: Int, $private: Boolean) {
          SaveReview(id: $id, mediaId: $mediaId, body: $body,
            summary: $summary, score: $score, private: $private) {
            id
            summary
            score
            private
            ... on Review {
              mediaId
              body
            }
          }
        }
        """
        variables: Dict[str, Any] = {"mediaId": media_id, "body": body}
        if review_id is not None:
            variables["id"] = review_id
        if summary is not None:
            variables["summary"] = summary
        if score is not None:
            variables["score"] = score
        if private is not None:
            variables["private"] = private

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def rate_review(self, review_id: int, rating: str = "UPVOTE") -> Dict[str, Any]:
        """Rate a review (UPVOTE, NOVEL_SCORE, or null for neutral)."""
        _require_token()
        mutation = """
        mutation RateReview($reviewId: Int, $rating: ReviewRating) {
          RateReview(reviewId: $reviewId, rating: $rating) {
            id
            summary
            score
            rating
          }
        }
        """
        resp = _run_mutation(
            mutation, {"reviewId": review_id, "rating": rating}
        )
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    def save_recommendation(
        self,
        media_id: int,
        media_recommendation_id: int,
        rating: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Recommend a media to another media."""
        _require_token()
        mutation = """
        mutation SaveRecommendation($mediaId: Int, $mediaRecommendationId: Int,
          $rating: RecommendationRating) {
          SaveRecommendation(mediaId: $mediaId,
            mediaRecommendationId: $mediaRecommendationId, rating: $rating) {
            id
            rating
            ... on Recommendation {
              mediaId
              mediaRecommendationId
            }
          }
        }
        """
        variables: Dict[str, Any] = {
            "mediaId": media_id,
            "mediaRecommendationId": media_recommendation_id,
        }
        if rating is not None:
            variables["rating"] = rating

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}

    # ------------------------------------------------------------------
    # User preferences
    # ------------------------------------------------------------------

    def update_user(self, **kwargs: Any) -> Dict[str, Any]:
        """Update the authenticated user's profile / preferences.

        Accepts arbitrary keyword arguments matching AniList ``UpdateUser``
        fields (about, titleLanguage, displayAdultContent, airingNotifications,
        scoreFormat, rowOrder, profileColor, notificationOptions, timezone,
        activityMergeTime, animeListOptions, mangaListOptions,
        staffNameLanguage, restrictMessagesToFollowing, disabledListActivity).
        """
        _require_token()
        # The UpdateUser mutation accepts many optional inputs.  We forward
        # every provided kwarg as a GraphQL variable, using camelCase names
        # expected by the AniList schema.
        mutation = """
        mutation UpdateUser($about: String, $titleLanguage: UserTitleLanguage,
          $displayAdultContent: Boolean, $airingNotifications: Boolean,
          $scoreFormat: ScoreFormat, $rowOrder: String, $profileColor: String,
          $notificationOptions: [NotificationOptionInput], $timezone: String,
          $activityMergeTime: Int, $animeListOptions: MediaListOptionsInput,
          $mangaListOptions: MediaListOptionsInput,
          $staffNameLanguage: UserStaffNameLanguage,
          $restrictMessagesToFollowing: Boolean,
          $disabledListActivity: [ListActivityOptionInput]) {
          UpdateUser(
            about: $about, titleLanguage: $titleLanguage,
            displayAdultContent: $displayAdultContent,
            airingNotifications: $airingNotifications,
            scoreFormat: $scoreFormat, rowOrder: $rowOrder,
            profileColor: $profileColor,
            notificationOptions: $notificationOptions, timezone: $timezone,
            activityMergeTime: $activityMergeTime,
            animeListOptions: $animeListOptions,
            mangaListOptions: $mangaListOptions,
            staffNameLanguage: $staffNameLanguage,
            restrictMessagesToFollowing: $restrictMessagesToFollowing,
            disabledListActivity: $disabledListActivity
          ) {
            id
            name
            about
            displayName
            titleLanguage
            displayAdultContent
            airingNotifications
            scoreFormat
            profileColor
            notificationOptions {
              type
              enabled
            }
          }
        }
        """
        # Convert snake_case kwargs to camelCase for the GraphQL variables.
        # This is a small, explicit helper — keep it local to avoid surprises.
        camel_map = {
            "about": "about",
            "title_language": "titleLanguage",
            "display_adult_content": "displayAdultContent",
            "airing_notifications": "airingNotifications",
            "score_format": "scoreFormat",
            "row_order": "rowOrder",
            "profile_color": "profileColor",
            "notification_options": "notificationOptions",
            "timezone": "timezone",
            "activity_merge_time": "activityMergeTime",
            "anime_list_options": "animeListOptions",
            "manga_list_options": "mangaListOptions",
            "staff_name_language": "staffNameLanguage",
            "restrict_messages_to_following": "restrictMessagesToFollowing",
            "disabled_list_activity": "disabledListActivity",
        }
        variables: Dict[str, Any] = {}
        for key, value in kwargs.items():
            gkey = camel_map.get(key, key)
            variables[gkey] = value

        resp = _run_mutation(mutation, variables)
        return resp.get("data", {}) if resp and "data" in resp else resp or {}


# Module-level singleton for convenience (mirrors anilist.py pattern)
mutations = AniListMutations()
