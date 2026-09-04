package handlers

import (
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/quota"
)

type OceanHandler struct {
	*WorldHandler
}

func NewOceanHandler(serviceConfig config.Config, generationPublisher GenerationPublisher, dailyAIQuota quota.DailyAIQuota, transport *RPCTransport) *OceanHandler {
	return &OceanHandler{WorldHandler: newWorldHandler(serviceConfig, contracts.WorldFamilyOcean, worldSubjects{
		worldList: contracts.OceanWorldListQuerySubject, worldGet: contracts.OceanWorldGetQuerySubject,
		variantCreate: contracts.OceanVariantCreateSubject, variantSelect: contracts.OceanVariantSelectSubject,
		worldPublish: contracts.OceanWorldPublishSubject, worldDelete: contracts.OceanWorldDeleteSubject,
		shareGet: contracts.OceanShareGetQuerySubject,
	}, generationPublisher, dailyAIQuota, transport)}
}
