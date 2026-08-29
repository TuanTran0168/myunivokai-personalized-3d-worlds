package contracts

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
)

const (
	SchemaVersionV1 = "1.0"

	CommandsStream = "MYUNIVOKAI_COMMANDS"
	EventsStream   = "MYUNIVOKAI_EVENTS"

	GenerateDNACommandSubject     = "myunivokai.commands.dna.generate.v1"
	ComposeUniverseCommandSubject = "myunivokai.commands.universe.compose.v1"
	ComposeNatureCommandSubject   = "myunivokai.commands.nature.compose.v1"
	ComposeOceanCommandSubject    = "myunivokai.commands.ocean.compose.v1"
	DNAGeneratedEventSubject      = "myunivokai.events.dna.generated.v1"
	DNAFailedEventSubject         = "myunivokai.events.dna.failed.v1"
	UniverseCompletedEventSubject = "myunivokai.events.universe.completed.v1"
	UniverseFailedEventSubject    = "myunivokai.events.universe.failed.v1"
	NatureCompletedEventSubject   = "myunivokai.events.nature.completed.v1"
	NatureFailedEventSubject      = "myunivokai.events.nature.failed.v1"
	OceanCompletedEventSubject    = "myunivokai.events.ocean.completed.v1"
	OceanFailedEventSubject       = "myunivokai.events.ocean.failed.v1"
	DNAJobGetQuerySubject         = "myunivokai.queries.dna.job.get.v1"
	UniverseWorldListQuerySubject = "myunivokai.queries.universe.world.list.v1"
	UniverseWorldGetQuerySubject  = "myunivokai.queries.universe.world.get.v1"
	UniverseVariantCreateSubject  = "myunivokai.queries.universe.variant.create.v1"
	UniverseVariantSelectSubject  = "myunivokai.queries.universe.variant.select.v1"
	UniverseWorldPublishSubject   = "myunivokai.queries.universe.world.publish.v1"
	UniverseShareGetQuerySubject  = "myunivokai.queries.universe.share.get.v1"
	NatureWorldListQuerySubject   = "myunivokai.queries.nature.world.list.v1"
	NatureWorldGetQuerySubject    = "myunivokai.queries.nature.world.get.v1"
	NatureVariantCreateSubject    = "myunivokai.queries.nature.variant.create.v1"
	NatureVariantSelectSubject    = "myunivokai.queries.nature.variant.select.v1"
	NatureWorldPublishSubject     = "myunivokai.queries.nature.world.publish.v1"
	NatureShareGetQuerySubject    = "myunivokai.queries.nature.share.get.v1"
	OceanWorldListQuerySubject    = "myunivokai.queries.ocean.world.list.v1"
	OceanWorldGetQuerySubject     = "myunivokai.queries.ocean.world.get.v1"
	OceanVariantCreateSubject     = "myunivokai.queries.ocean.variant.create.v1"
	OceanVariantSelectSubject     = "myunivokai.queries.ocean.variant.select.v1"
	OceanWorldPublishSubject      = "myunivokai.queries.ocean.world.publish.v1"
	OceanShareGetQuerySubject     = "myunivokai.queries.ocean.share.get.v1"

	JobStatusQueued     JobStatus = "queued"
	JobStatusProcessing JobStatus = "processing"
	JobStatusCompleted  JobStatus = "completed"
	JobStatusFailed     JobStatus = "failed"

	WorldFamilyUniverse WorldFamily = "universe"
	WorldFamilyNature   WorldFamily = "nature"
	// WorldFamilyOcean is deliberately "ocean" and not "abyss". The abyss is
	// one end of this family's own depth axis, and a sunlit reef config living
	// under a subject called "abyss" would be a permanent mismatch across the
	// database name, the share URLs and the seed streams — none of which can be
	// renamed once a share link is public. The evocative names live where this
	// repository already puts them: depth-zone labels, landmark kinds,
	// RarityFeature.Label and the AI-written sceneName.
	WorldFamilyOcean WorldFamily = "ocean"

	minimumNicknameCharacters  = 2
	maximumNicknameCharacters  = 32
	maximumRoleCharacters      = 80
	minimumInterests           = 3
	maximumInterests           = 8
	minimumTraits              = 3
	maximumTraits              = 6
	minimumListItemCharacters  = 2
	maximumListItemCharacters  = 32
	minimumGoalCharacters      = 10
	maximumGoalCharacters      = 220
	maximumChallengeCharacters = 220
	minimumFacets              = 3
	maximumFacets              = 7
	maximumArchetypeCharacters = 40
	maximumSceneNameCharacters = 80
	maximumQuoteCharacters     = 100
	maximumNarrativeCharacters = 240
	maximumMeaningCharacters   = 180
	minimumScore               = 0
	maximumScore               = 100
)

var hexadecimalColorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

var allowedMoods = map[string]struct{}{
	"futuristic calm": {},
	"focused":         {},
	"dreamy":          {},
	"energetic":       {},
	"reflective":      {},
	"curious":         {},
}

// World styles, PER FAMILY.
//
// It used to be one set shared by all three, which was only ever true of the
// universe: the five names below under WorldFamilyUniverse are sky and orbit
// themes, and nature-service and ocean-service stored whichever of them arrived
// and then never read it again. The create form eventually hid the picker for
// those two families rather than keep offering a control that changed nothing,
// which is the right call for a control that changes nothing and the wrong one
// for a family that has two families' worth of unexposed variation in it.
//
// So each family names its own, and each one's service reads it. The FIRST
// entry of every family is its neutral style — the world as the builder already
// made it — which is what lets this be added without invalidating a single
// stored world.
// The vocabulary the AI is asked to answer with in visualHints.theme, which is
// NOT the same field as the visitor's PreferredWorldStyle and is not per-family.
// It happens to be the universe's five style names because that is what the DNA
// prompt asks for; every family stores the answer and only universe-service
// reads it (sky_scene_profile.go, and the post-FX grade).
var allowedDNAVisualThemes = map[string]struct{}{
	"cosmic-galaxy": {},
	"nebula":        {},
	"crystal":       {},
	"aurora":        {},
	"cyber-orbit":   {},
}

var allowedWorldStylesByFamily = map[WorldFamily]map[string]struct{}{
	WorldFamilyUniverse: {
		"cosmic-galaxy": {},
		"nebula":        {},
		"crystal":       {},
		"aurora":        {},
		"cyber-orbit":   {},
	},
	WorldFamilyNature: {
		"wildwood":      {},
		"ancient-grove": {},
		"mistwood":      {},
		"emberfall":     {},
		"lanternwood":   {},
	},
	WorldFamilyOcean: {
		"open-water":     {},
		"coral-garden":   {},
		"kelp-cathedral": {},
		"crystal-shoal":  {},
		"silt-drift":     {},
	},
}

// DefaultWorldStyleForFamily is the neutral style, and the answer for a stored
// world that predates its family having styles at all.
//
// Every family's neutral profile is a no-op — all multipliers 1, all biases 0 —
// so a world created before this existed renders byte-for-byte as it did. That
// is not a nicety: the golden fixtures in each family service ARE the
// compatibility contract, and a style axis whose default moved would have
// forced a schema bump on all three families at once.
func DefaultWorldStyleForFamily(family WorldFamily) string {
	switch family {
	case WorldFamilyNature:
		return "wildwood"
	case WorldFamilyOcean:
		return "open-water"
	default:
		return "cosmic-galaxy"
	}
}

// WorldStyleAllowedForFamily reports whether this family offers this style.
// An empty style is allowed and means the family's default — a world stored
// before its family had styles has no style, and rejecting it would make old
// records unreadable.
func WorldStyleAllowedForFamily(family WorldFamily, style string) bool {
	if style == "" {
		return true
	}
	styles, found := allowedWorldStylesByFamily[family]
	if !found {
		return false
	}
	_, allowed := styles[style]
	return allowed
}

type WorldFamily string

func (family WorldFamily) Valid() bool {
	return family == WorldFamilyUniverse || family == WorldFamilyNature || family == WorldFamilyOcean
}

func (family WorldFamily) ComposeCommandSubject() (string, error) {
	switch family {
	case WorldFamilyUniverse:
		return ComposeUniverseCommandSubject, nil
	case WorldFamilyNature:
		return ComposeNatureCommandSubject, nil
	case WorldFamilyOcean:
		return ComposeOceanCommandSubject, nil
	default:
		return "", fmt.Errorf("unsupported world family %q", family)
	}
}

func (family WorldFamily) CompletedEventSubject() (string, error) {
	switch family {
	case WorldFamilyUniverse:
		return UniverseCompletedEventSubject, nil
	case WorldFamilyNature:
		return NatureCompletedEventSubject, nil
	case WorldFamilyOcean:
		return OceanCompletedEventSubject, nil
	default:
		return "", fmt.Errorf("unsupported world family %q", family)
	}
}

func (family WorldFamily) FailedEventSubject() (string, error) {
	switch family {
	case WorldFamilyUniverse:
		return UniverseFailedEventSubject, nil
	case WorldFamilyNature:
		return NatureFailedEventSubject, nil
	case WorldFamilyOcean:
		return OceanFailedEventSubject, nil
	default:
		return "", fmt.Errorf("unsupported world family %q", family)
	}
}

type Envelope[DataType any] struct {
	JobID     string    `json:"jobId"`
	Timestamp time.Time `json:"timestamp"`
	Data      DataType  `json:"data"`
}

func NewEnvelope[DataType any](jobID string, data DataType) Envelope[DataType] {
	return Envelope[DataType]{JobID: jobID, Timestamp: time.Now().UTC(), Data: data}
}

func (envelope Envelope[DataType]) Validate() error {
	if strings.TrimSpace(envelope.JobID) == "" {
		return errors.New("jobId is required")
	}
	if envelope.Timestamp.IsZero() {
		return errors.New("timestamp is required")
	}
	return nil
}

type WorldInput struct {
	Nickname            string   `json:"nickname"`
	Role                string   `json:"role,omitempty"`
	Interests           []string `json:"interests"`
	Traits              []string `json:"traits"`
	Goal                string   `json:"goal"`
	Challenge           string   `json:"challenge,omitempty"`
	Mood                string   `json:"mood"`
	FavoriteColors      []string `json:"favoriteColors"`
	PreferredWorldStyle string   `json:"preferredWorldStyle"`
}

func (input WorldInput) Normalize() WorldInput {
	input.Nickname = strings.TrimSpace(input.Nickname)
	input.Role = strings.TrimSpace(input.Role)
	input.Goal = strings.TrimSpace(input.Goal)
	input.Challenge = strings.TrimSpace(input.Challenge)
	input.Mood = strings.ToLower(strings.TrimSpace(input.Mood))
	input.PreferredWorldStyle = strings.ToLower(strings.TrimSpace(input.PreferredWorldStyle))
	input.Interests = trimSlice(input.Interests)
	input.Traits = trimSlice(input.Traits)
	input.FavoriteColors = trimSlice(input.FavoriteColors)
	return input
}

type ValidationDetail struct {
	Field   string `json:"field"`
	Message string `json:"message"`
}

// Validate takes the family because the world style is the one field whose
// vocabulary differs by family — "nebula" is a real universe and a nonsense
// forest. Every call site already had the family in hand one line above, next
// to its own family.Valid() check.
func (input WorldInput) Validate(family WorldFamily) []ValidationDetail {
	normalizedInput := input.Normalize()
	var details []ValidationDetail
	if runeLength(normalizedInput.Nickname) < minimumNicknameCharacters || runeLength(normalizedInput.Nickname) > maximumNicknameCharacters {
		details = append(details, ValidationDetail{Field: "nickname", Message: "Nickname must be 2-32 characters."})
	}
	if normalizedInput.Role != "" && runeLength(normalizedInput.Role) > maximumRoleCharacters {
		details = append(details, ValidationDetail{Field: "role", Message: "Role must be 80 characters or fewer."})
	}
	details = append(details, validateStringList("interests", normalizedInput.Interests, minimumInterests, maximumInterests, "Choose 3-8 interests.", "Interest must be 2-32 characters.")...)
	details = append(details, validateStringList("traits", normalizedInput.Traits, minimumTraits, maximumTraits, "Choose 3-6 traits.", "Trait must be 2-32 characters.")...)
	if runeLength(normalizedInput.Goal) < minimumGoalCharacters || runeLength(normalizedInput.Goal) > maximumGoalCharacters {
		details = append(details, ValidationDetail{Field: "goal", Message: "Goal must be 10-220 characters."})
	}
	if normalizedInput.Challenge != "" && runeLength(normalizedInput.Challenge) > maximumChallengeCharacters {
		details = append(details, ValidationDetail{Field: "challenge", Message: "Challenge must be 220 characters or fewer."})
	}
	if _, found := allowedMoods[normalizedInput.Mood]; !found {
		details = append(details, ValidationDetail{Field: "mood", Message: "Mood is not supported."})
	}
	if len(normalizedInput.FavoriteColors) < 1 || len(normalizedInput.FavoriteColors) > 4 {
		details = append(details, ValidationDetail{Field: "favoriteColors", Message: "Choose 1-4 favorite colors."})
	}
	for colorIndex, color := range normalizedInput.FavoriteColors {
		if !hexadecimalColorPattern.MatchString(color) {
			details = append(details, ValidationDetail{Field: fmt.Sprintf("favoriteColors.%d", colorIndex), Message: "Color must be a hex value like #8B5CF6."})
		}
	}
	if !WorldStyleAllowedForFamily(family, normalizedInput.PreferredWorldStyle) {
		details = append(details, ValidationDetail{Field: "preferredWorldStyle", Message: "World style is not supported for this world family."})
	}
	return details
}

type TraitScores struct {
	Creativity int `json:"creativity"`
	Discipline int `json:"discipline"`
	Curiosity  int `json:"curiosity"`
	Energy     int `json:"energy"`
	Focus      int `json:"focus"`
}

type EnergySignature struct {
	Primary   string `json:"primary"`
	Secondary string `json:"secondary"`
	Intensity int    `json:"intensity"`
}

type ProfileFacet struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Meaning string `json:"meaning"`
	Energy  int    `json:"energy"`
}

type VisualHints struct {
	Theme         string `json:"theme"`
	CoreSymbol    string `json:"coreSymbol"`
	PaletteIntent string `json:"paletteIntent"`
	MotionIntent  string `json:"motionIntent"`
}

type ProfileDNA struct {
	SchemaVersion   string          `json:"schemaVersion"`
	Archetype       string          `json:"archetype"`
	SceneName       string          `json:"sceneName"`
	Quote           string          `json:"quote"`
	ShortNarrative  string          `json:"shortNarrative"`
	TraitScores     TraitScores     `json:"traitScores"`
	EnergySignature EnergySignature `json:"energySignature"`
	Facets          []ProfileFacet  `json:"facets"`
	VisualHints     VisualHints     `json:"visualHints"`
}

func (profileDNA ProfileDNA) Validate() error {
	if runeLength(profileDNA.Archetype) < minimumListItemCharacters || runeLength(profileDNA.Archetype) > maximumArchetypeCharacters {
		return errors.New("archetype must be 2-40 characters")
	}
	if runeLength(profileDNA.SceneName) < minimumInterests || runeLength(profileDNA.SceneName) > maximumSceneNameCharacters {
		return errors.New("sceneName must be 3-80 characters")
	}
	if runeLength(profileDNA.Quote) > maximumQuoteCharacters {
		return errors.New("quote must be 100 characters or fewer")
	}
	if runeLength(profileDNA.ShortNarrative) > maximumNarrativeCharacters {
		return errors.New("shortNarrative must be 240 characters or fewer")
	}
	scores := map[string]int{
		"creativity": profileDNA.TraitScores.Creativity,
		"discipline": profileDNA.TraitScores.Discipline,
		"curiosity":  profileDNA.TraitScores.Curiosity,
		"energy":     profileDNA.TraitScores.Energy,
		"focus":      profileDNA.TraitScores.Focus,
	}
	for scoreName, scoreValue := range scores {
		if scoreValue < minimumScore || scoreValue > maximumScore {
			return fmt.Errorf("traitScores.%s must be 0-100", scoreName)
		}
	}
	if profileDNA.EnergySignature.Intensity < minimumScore || profileDNA.EnergySignature.Intensity > maximumScore {
		return errors.New("energySignature.intensity must be 0-100")
	}
	if len(profileDNA.Facets) < minimumFacets || len(profileDNA.Facets) > maximumFacets {
		return errors.New("facets must contain 3-7 items")
	}
	for facetIndex, facet := range profileDNA.Facets {
		if runeLength(facet.Name) < minimumListItemCharacters || runeLength(facet.Name) > maximumArchetypeCharacters {
			return fmt.Errorf("facets.%d.name must be 2-40 characters", facetIndex)
		}
		if runeLength(facet.Meaning) > maximumMeaningCharacters {
			return fmt.Errorf("facets.%d.meaning must be 180 characters or fewer", facetIndex)
		}
		if facet.Energy < minimumScore || facet.Energy > maximumScore {
			return fmt.Errorf("facets.%d.energy must be 0-100", facetIndex)
		}
	}
	if _, found := allowedDNAVisualThemes[strings.ToLower(strings.TrimSpace(profileDNA.VisualHints.Theme))]; !found {
		return errors.New("visualHints.theme is not supported")
	}
	return nil
}

type GenerateDNAData struct {
	Family WorldFamily `json:"family"`
	Input  WorldInput  `json:"input"`
}

type ProfileSummary struct {
	Nickname string `json:"nickname"`
	Role     string `json:"role,omitempty"`
}

type VisualIntent struct {
	Mood                string   `json:"mood"`
	FavoriteColors      []string `json:"favoriteColors"`
	PreferredWorldStyle string   `json:"preferredWorldStyle"`
}

type ComposeWorldData struct {
	Family       WorldFamily    `json:"family"`
	ProfileID    string         `json:"profileId"`
	DNAVersionID string         `json:"dnaVersionId"`
	Profile      ProfileSummary `json:"profile"`
	VisualIntent VisualIntent   `json:"visualIntent"`
	ProfileDNA   ProfileDNA     `json:"profileDNA"`
}

type DNAGeneratedData struct {
	Family       WorldFamily `json:"family"`
	ProfileID    string      `json:"profileId"`
	DNAVersionID string      `json:"dnaVersionId"`
}

type DNAFailedData struct {
	Family  WorldFamily `json:"family"`
	Code    string      `json:"code"`
	Message string      `json:"message"`
}

// FamilyCompletedData's Snapshot field was added for analytics-service and
// is deliberately a pointer: events already sitting in MYUNIVOKAI_EVENTS when
// it shipped decode to nil, which a reader can tell apart from a snapshot
// that really is all zeroes. Adding it is backward compatible in both
// directions — encoding/json ignores unknown fields, and dna-service compiles
// against this same package and simply does not read it. See
// agent-system/plans/services/analytics-service-plan.md#the-event-gap.
type FamilyCompletedData struct {
	Family       WorldFamily    `json:"family"`
	ProfileID    string         `json:"profileId"`
	DNAVersionID string         `json:"dnaVersionId"`
	WorldID      string         `json:"worldId"`
	Snapshot     *WorldSnapshot `json:"snapshot,omitempty"`
}

type FamilyFailedData struct {
	Family       WorldFamily `json:"family"`
	ProfileID    string      `json:"profileId,omitempty"`
	DNAVersionID string      `json:"dnaVersionId,omitempty"`
	Code         string      `json:"code"`
	Message      string      `json:"message"`
}

type JobStatus string

type Job struct {
	JobID        string      `json:"jobId"`
	Family       WorldFamily `json:"family"`
	Status       JobStatus   `json:"status"`
	ProfileID    string      `json:"profileId,omitempty"`
	DNAVersionID string      `json:"dnaVersionId,omitempty"`
	WorldID      string      `json:"worldId,omitempty"`
	Error        *RPCError   `json:"error,omitempty"`
	CreatedAt    time.Time   `json:"createdAt"`
	UpdatedAt    time.Time   `json:"updatedAt"`
}

type WorldQueryData struct {
	WorldID string `json:"worldId"`
}

type WorldListQueryData struct {
	WorldIDs []string `json:"worldIds"`
}

type VariantCreateData struct {
	WorldID string `json:"worldId"`
}

type VariantSelectData struct {
	WorldID   string `json:"worldId"`
	VariantID string `json:"variantId"`
}

type PublishWorldData struct {
	WorldID string `json:"worldId"`
}

type ShareQueryData struct {
	ShareSlug string `json:"shareSlug"`
}

type JobQueryData struct {
	JobID string `json:"jobId"`
}

type RPCError struct {
	Code    string             `json:"code"`
	Message string             `json:"message"`
	Details []ValidationDetail `json:"details,omitempty"`
}

type RPCResponseData struct {
	StatusCode int             `json:"statusCode"`
	Payload    json.RawMessage `json:"payload,omitempty"`
	Error      *RPCError       `json:"error,omitempty"`
}

func SuccessRPCEnvelope(jobID string, statusCode int, payload any) (Envelope[RPCResponseData], error) {
	encodedPayload, err := json.Marshal(payload)
	if err != nil {
		return Envelope[RPCResponseData]{}, fmt.Errorf("marshal rpc payload: %w", err)
	}
	return NewEnvelope(jobID, RPCResponseData{StatusCode: statusCode, Payload: encodedPayload}), nil
}

func ErrorRPCEnvelope(jobID string, statusCode int, code, message string) Envelope[RPCResponseData] {
	return NewEnvelope(jobID, RPCResponseData{StatusCode: statusCode, Error: &RPCError{Code: code, Message: message}})
}

func validateStringList(fieldName string, values []string, minimumCount, maximumCount int, countMessage, itemMessage string) []ValidationDetail {
	var details []ValidationDetail
	if len(values) < minimumCount || len(values) > maximumCount {
		details = append(details, ValidationDetail{Field: fieldName, Message: countMessage})
	}
	for valueIndex, value := range values {
		if runeLength(value) < minimumListItemCharacters || runeLength(value) > maximumListItemCharacters {
			details = append(details, ValidationDetail{Field: fmt.Sprintf("%s.%d", fieldName, valueIndex), Message: itemMessage})
		}
	}
	return details
}

func trimSlice(values []string) []string {
	trimmedValues := make([]string, 0, len(values))
	for _, value := range values {
		if trimmedValue := strings.TrimSpace(value); trimmedValue != "" {
			trimmedValues = append(trimmedValues, trimmedValue)
		}
	}
	return trimmedValues
}

func runeLength(value string) int {
	return len([]rune(strings.TrimSpace(value)))
}
