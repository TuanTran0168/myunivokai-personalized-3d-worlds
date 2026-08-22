package models

// OceanSceneConfig is the stored scene contract for the ocean family.
// Renderers are keyed by (sceneType, schemaVersion). The config deliberately
// stays small (~3-4 KB): only semantic and hero placements are stored
// (landmarks); mass scatter — flora, marine snow, plankton, school paths — is
// derived frontend-side from the placement/path seeds embedded here, the same
// pattern universe-service and nature-service already use.
//
// The one section no other family has is Depth. It is not decoration: every
// number under Water and Lighting is derived from it by the depth curve in
// internal/services/depth_curve.go and then STORED, so re-tuning the curve
// later changes new worlds and leaves existing ones exactly as they were
// rendered.
//
// There is no hdriKey anywhere in this contract. A thousand metres down there
// is no sky to sample.
type OceanSceneConfig struct {
	SchemaVersion string  `json:"schemaVersion"`
	SceneType     string  `json:"sceneType"`
	SceneName     string  `json:"sceneName"`
	Archetype     string  `json:"archetype"`
	Quote         string  `json:"quote"`
	Theme         string  `json:"theme"`
	Palette       Palette `json:"palette"`

	Depth           DepthConfig           `json:"depth"`
	Water           WaterConfig           `json:"water"`
	Lighting        OceanLightingConfig   `json:"lighting"`
	Seafloor        SeafloorConfig        `json:"seafloor"`
	Current         CurrentConfig         `json:"current"`
	Flora           FloraConfig           `json:"flora"`
	Fauna           FaunaConfig           `json:"fauna"`
	Bioluminescence BioluminescenceConfig `json:"bioluminescence"`
	Landmarks       []LandmarkSceneConfig `json:"landmarks"`

	Camera CameraConfig      `json:"camera"`
	PostFX PostFXConfig      `json:"postFX"`
	HUD    HUDConfig         `json:"hud"`
	Assets OceanAssetsConfig `json:"assets"`
}

// DepthConfig is this family's main axis, the counterpart of the forest's
// season. BlendTowardZone/BlendAmount model the same "giao mùa" idea one axis
// over: a world sitting near a zone boundary lerps its dressing toward the
// neighbouring zone rather than snapping.
//
// Metres is the authoritative value; Zone is the label derived from it. A
// renderer that wants a continuous response reads Metres, one that wants a
// discrete dressing reads Zone, and the two can never disagree because the
// builder derives the second from the first.
// SeafloorMetres is the second number this family cannot do without, and its
// absence was the first draft's worst mistake: every world put a seabed a few
// metres under the camera no matter how deep it was. That is only true in
// shallow water. The mean depth of the ocean is 3682 m, so a world floating at
// 143 m has the bottom roughly three and a half KILOMETRES below it and must
// show nothing down there at all — open water fading to black.
//
// Metres is how deep the VIEWER is; SeafloorMetres is how deep the SEABED is.
// Their difference is the water below you, and whether it is smaller than
// water.visibilityMetres is the only thing that decides if a floor is drawn.
// One subtraction replaces what would otherwise be a per-zone "has floor" flag.
type DepthConfig struct {
	Metres          float64 `json:"metres"`
	SeafloorMetres  float64 `json:"seafloorMetres"`
	Zone            string  `json:"zone"`
	BlendTowardZone string  `json:"blendTowardZone,omitempty"`
	BlendAmount     float64 `json:"blendAmount,omitempty"`
}

// FloorClearanceMetres is the water between the viewer and the seabed.
func (d DepthConfig) FloorClearanceMetres() float64 {
	return d.SeafloorMetres - d.Metres
}

// WaterConfig is entirely derived from DepthConfig by the depth curve and then
// stored. VisibilityMetres is where the fog reaches full opacity — it is what
// makes a giant passing at fog distance a silhouette rather than a prop.
type WaterConfig struct {
	FogColor         string  `json:"fogColor"`
	FogDensity       float64 `json:"fogDensity"`
	VisibilityMetres float64 `json:"visibilityMetres"`
	// TintStrength is how hard surviving light pushes objects toward the
	// water colour. It is what makes a red coral read brown-grey at 30 m
	// without anyone hand-picking a brown.
	TintStrength float64 `json:"tintStrength"`

	// JerlovWaterType names the water on Jerlov's 1976 optical scale — "I"
	// through "III" for open ocean, "1C" through "9C" for coastal. It is what
	// decides the water's hue, its per-channel depth curve and how coherent a
	// caustic pattern can still be, none of which a single visibility number
	// can answer. Before this existed the renderer inferred it from
	// VisibilityMetres, which meant the answer lived outside the world.
	JerlovWaterType string `json:"jerlovWaterType"`

	// WindSpeedMetresPerSecond is the wind at 10 m above the sea — the number
	// every marine forecast, every buoy and every paper on wave spectra uses.
	// The whole surface comes out of it: significant wave height
	// (Pierson-Moskowitz 1964), peak wavelength, and whitecap coverage
	// (Monahan & O'Muircheartaigh 1980). It is weather, not a consequence of
	// depth, which is why it is the one value under Water that is drawn.
	WindSpeedMetresPerSecond float64 `json:"windSpeedMetresPerSecond"`
}

// OceanLightingConfig carries the sun as two angles, because on this axis the
// sun is sometimes in the scene and sometimes only its consequences are.
//
//   - SurfaceElevationRadians is the height of the sun above the horizon. Under
//     the water that is the angle the light ENTERS at, which sets the direction
//     of the god rays and the scale of the caustic pattern. Above the water it
//     is the sun itself, and low values are the golden hour.
//   - SurfaceAzimuthRadians is its compass bearing, and it exists because the
//     renderer needs to know where to PUT the camera. The frame is composed
//     looking toward the sun, so a bearing that is not carried in the config is
//     a bearing the backend cannot vary — which is what it was: one shared
//     constant, so every above-water world in the family had its sun in the
//     same place. The prototype set this per view (0 for its golden hour, 118
//     degrees for its daylight sea) and it was the only authored parameter in
//     that study with no counterpart here.
//
// GodRayStrength and CausticStrength reach exactly zero on their own as depth
// crosses the sunlight floor. No branch anywhere says "if abyss then disable
// caustics"; that is why one renderer covers a sunlit reef and an abyssal
// trench without a mode flag.
type OceanLightingConfig struct {
	SurfaceLightColor       string  `json:"surfaceLightColor"`
	SurfaceElevationRadians float64 `json:"surfaceElevationRadians"`
	SurfaceAzimuthRadians   float64 `json:"surfaceAzimuthRadians"`
	GodRayStrength          float64 `json:"godRayStrength"`
	CausticStrength         float64 `json:"causticStrength"`
	AmbientColor            string  `json:"ambientColor"`
	Exposure                float64 `json:"exposure"`
}

type SeafloorConfig struct {
	// PlacementSeed feeds the frontend's deterministic scatter of rocks and
	// sediment; the backend only decides the counts and bounds.
	PlacementSeed            string  `json:"placementSeed"`
	BasinRadius              float64 `json:"basinRadius"`
	RidgeAmplitude           float64 `json:"ridgeAmplitude"`
	RidgeFrequency           float64 `json:"ridgeFrequency"`
	RockCount                int     `json:"rockCount"`
	SedimentTuftCountDesktop int     `json:"sedimentTuftCountDesktop"`
	SedimentTuftCountMobile  int     `json:"sedimentTuftCountMobile"`
}

// CurrentConfig is the forest's wind, one medium denser. MarineSnow is the
// particle layer that reads as water having body — it exists at every depth,
// unlike the forest's four mutually exclusive seasonal systems.
type CurrentConfig struct {
	Kind                   string  `json:"kind"`
	Intensity              float64 `json:"intensity"`
	DirectionRadians       float64 `json:"directionRadians"`
	GustFrequency          float64 `json:"gustFrequency"`
	MarineSnowCountDesktop int     `json:"marineSnowCountDesktop"`
	MarineSnowCountMobile  int     `json:"marineSnowCountMobile"`
}

type FloraSpeciesMixEntry struct {
	ModelKey string  `json:"modelKey"`
	Weight   float64 `json:"weight"`
}

type FloraConfig struct {
	PlacementSeed string                 `json:"placementSeed"`
	CountDesktop  int                    `json:"countDesktop"`
	CountMobile   int                    `json:"countMobile"`
	SpeciesMix    []FloraSpeciesMixEntry `json:"speciesMix"`
	ScaleMin      float64                `json:"scaleMin"`
	ScaleMax      float64                `json:"scaleMax"`
	SwayStrength  float64                `json:"swayStrength"`
	// DepthTintStrength is per-section rather than global because kelp keeps
	// more of its own colour than a rock does at the same depth.
	DepthTintStrength float64 `json:"depthTintStrength"`
}

// FishSchoolConfig is a group, not a list of individuals: Cohesion and
// Separation are what make a school move as one body instead of as N fish on
// parallel rails.
type FishSchoolConfig struct {
	ModelKey     string  `json:"modelKey"`
	Count        int     `json:"count"`
	PathSeed     string  `json:"pathSeed"`
	DepthBandMin float64 `json:"depthBandMin"`
	DepthBandMax float64 `json:"depthBandMax"`
	SwimSpeed    float64 `json:"swimSpeed"`
	Cohesion     float64 `json:"cohesion"`
	Separation   float64 `json:"separation"`
}

// DrifterConfig is the jellyfish/siphonophore layer: things that pulse rather
// than swim. EmissiveColor is theirs alone — a drifter is the only creature
// that carries its own light at every depth.
type DrifterConfig struct {
	ModelKey      string  `json:"modelKey"`
	Count         int     `json:"count"`
	PathSeed      string  `json:"pathSeed"`
	PulseRate     float64 `json:"pulseRate"`
	EmissiveColor string  `json:"emissiveColor"`
}

// GiantConfig is at most one per world. ApproachDistance is deliberately near
// the water's VisibilityMetres: a giant is a moment that arrives out of the
// fog and leaves into it, not a model parked in the middle distance.
type GiantConfig struct {
	ModelKey            string  `json:"modelKey"`
	PassSeed            string  `json:"passSeed"`
	ApproachDistance    float64 `json:"approachDistance"`
	PassDurationSeconds float64 `json:"passDurationSeconds"`
}

type FaunaConfig struct {
	Schools  []FishSchoolConfig `json:"schools"`
	Drifters []DrifterConfig    `json:"drifters"`
	Giants   []GiantConfig      `json:"giants"`
}

// BioluminescenceConfig must read on its own. The scene has to stay legible
// with post-processing disabled, so BloomIntensity brightens what is already
// there rather than being what makes it visible.
type BioluminescenceConfig struct {
	PlanktonCount  int      `json:"planktonCount"`
	BloomIntensity float64  `json:"bloomIntensity"`
	EmissiveColors []string `json:"emissiveColors"`
	FlickerSeed    string   `json:"flickerSeed"`
}

// LandmarkSceneConfig is the ocean counterpart of a forest landmark: the
// clickable POI layer, placed polar around the basin centre and stored (not
// derived) because landmarks are the hero layer of the portrait. The field set
// is identical to the forest's on purpose — the frontend's POI extraction,
// hover, HUD and click-to-focus are family-agnostic and stay that way.
type LandmarkSceneConfig struct {
	Key              string  `json:"key"`
	Name             string  `json:"name"`
	Meaning          string  `json:"meaning"`
	Kind             string  `json:"kind"`
	AngleRadians     float64 `json:"angleRadians"`
	RadiusFromCenter float64 `json:"radiusFromCenter"`
	// HeightAboveFloor is the one field the forest has no use for: an ocean is
	// a volume, so a landmark can sit on the floor or hang in the water column.
	HeightAboveFloor float64 `json:"heightAboveFloor"`
	AccentColor      string  `json:"accentColor"`
	Energy           int     `json:"energy"`
}

type Palette struct {
	Background string   `json:"background"`
	Primary    string   `json:"primary"`
	Secondary  string   `json:"secondary"`
	Accent     string   `json:"accent"`
	Gradient   []string `json:"gradient"`
}

type CameraConfig struct {
	Distance float64 `json:"distance"`
	FOV      float64 `json:"fov"`
}

type PostFXGradeConfig struct {
	HueRadians float64 `json:"hueRadians"`
	Saturation float64 `json:"saturation"`
	Brightness float64 `json:"brightness"`
	Contrast   float64 `json:"contrast"`
}

type PostFXConfig struct {
	BloomIntensity float64           `json:"bloomIntensity"`
	Grade          PostFXGradeConfig `json:"grade"`
}

type HUDConfig struct {
	ShowTraitBars bool `json:"showTraitBars"`
	ShowLabels    bool `json:"showLabels"`
}

// OceanAssetsConfig lists every species/model key the config references, in a
// deterministic first-use order, so the renderer can prepare them without
// scanning the whole config. It carries no hdriKey — the ocean family has no
// sky dome and no environment map, which is also why its download budget is a
// fraction of the forest's.
type OceanAssetsConfig struct {
	CatalogVersion string   `json:"catalogVersion"`
	ModelKeys      []string `json:"modelKeys"`
}
