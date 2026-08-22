package handlers

import (
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
)

type OceanHandler struct {
	*WorldHandler
}

func NewOceanHandler(serviceConfig config.Config, generationPublisher GenerationPublisher, transport *RPCTransport) *OceanHandler {
	return &OceanHandler{WorldHandler: newWorldHandler(serviceConfig, contracts.WorldFamilyOcean, worldSubjects{
		worldList: contracts.OceanWorldListQuerySubject, worldGet: contracts.OceanWorldGetQuerySubject,
		variantCreate: contracts.OceanVariantCreateSubject, variantSelect: contracts.OceanVariantSelectSubject,
		worldPublish: contracts.OceanWorldPublishSubject, shareGet: contracts.OceanShareGetQuerySubject,
	}, generationPublisher, transport)}
}
