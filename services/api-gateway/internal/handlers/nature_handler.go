package handlers

import (
	contracts "github.com/myunivokai/myunivokai/contracts/go"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/config"
	"github.com/myunivokai/myunivokai/services/api-gateway/internal/quota"
)

type NatureHandler struct {
	*WorldHandler
}

func NewNatureHandler(serviceConfig config.Config, generationPublisher GenerationPublisher, dailyAIQuota quota.DailyAIQuota, transport *RPCTransport) *NatureHandler {
	return &NatureHandler{WorldHandler: newWorldHandler(serviceConfig, contracts.WorldFamilyNature, worldSubjects{
		worldList: contracts.NatureWorldListQuerySubject, worldGet: contracts.NatureWorldGetQuerySubject,
		variantCreate: contracts.NatureVariantCreateSubject, variantSelect: contracts.NatureVariantSelectSubject,
		worldPublish: contracts.NatureWorldPublishSubject, worldDelete: contracts.NatureWorldDeleteSubject,
		shareGet: contracts.NatureShareGetQuerySubject,
	}, generationPublisher, dailyAIQuota, transport)}
}
