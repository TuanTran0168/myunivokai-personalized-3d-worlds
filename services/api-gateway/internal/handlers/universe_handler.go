package handlers

import (
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
)

type UniverseHandler struct {
	*WorldHandler
}

func NewUniverseHandler(serviceConfig config.Config, generationPublisher GenerationPublisher, transport *RPCTransport) *UniverseHandler {
	return &UniverseHandler{WorldHandler: newWorldHandler(serviceConfig, contracts.WorldFamilyUniverse, worldSubjects{
		worldList: contracts.UniverseWorldListQuerySubject, worldGet: contracts.UniverseWorldGetQuerySubject,
		variantCreate: contracts.UniverseVariantCreateSubject, variantSelect: contracts.UniverseVariantSelectSubject,
		worldPublish: contracts.UniverseWorldPublishSubject, worldDelete: contracts.UniverseWorldDeleteSubject,
		shareGet: contracts.UniverseShareGetQuerySubject,
	}, generationPublisher, transport)}
}
