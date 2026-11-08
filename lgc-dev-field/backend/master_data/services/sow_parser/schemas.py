"""Validação de schema forte do JSON estruturado retornado pela IA — usa
DRF Serializer (mecanismo "já disponível" no projeto, ver pedido original:
"Usar Pydantic, DRF serializer ou mecanismo equivalente já disponível"),
não Pydantic (que não está nas dependências do projeto). Nunca confia
diretamente no JSON devolvido pelo modelo: `validate_ai_output` sempre
passa pelo serializer antes de qualquer campo ser usado."""

from rest_framework import serializers


class AiSowItemSchema(serializers.Serializer):
    """Um item da lista `items` do JSON retornado pela IA — todos os
    campos são opcionais/anuláveis: a IA deve devolver null (nunca
    inventar) quando não tiver certeza (ver prompt em
    master_data/ai/prompts/sow_parser_v1.py)."""

    raw_text = serializers.CharField(required=False, allow_blank=True, allow_null=True, default=None)
    item_type = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    cable_family_code = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    cable_spec_code = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    network_code = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    workstream_code = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    paths = serializers.ListField(child=serializers.CharField(), required=False, default=list)
    quantity = serializers.IntegerField(required=False, allow_null=True, default=None)
    unit = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    length_type = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    length_m = serializers.FloatField(required=False, allow_null=True, default=None)
    medium = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    preterminated = serializers.BooleanField(required=False, allow_null=True, default=None)
    color = serializers.CharField(required=False, allow_null=True, allow_blank=True, default=None)
    fiber_count = serializers.IntegerField(required=False, allow_null=True, default=None)
    confidence_score = serializers.FloatField(required=False, default=0.5)
    warnings = serializers.ListField(child=serializers.CharField(), required=False, default=list)


class AiSowParserOutputSchema(serializers.Serializer):
    items = AiSowItemSchema(many=True)


def validate_ai_output(data):
    """Valida `data` (o dict já parseado do JSON retornado pela IA) contra
    o schema acima. Levanta AiSowParserSchemaError com uma mensagem clara
    em caso de estrutura inválida — nunca deixa um payload fora do formato
    esperado seguir adiante. Retorna a lista de dicts já validados
    (`validated_data["items"]`), prontos para o merge determinístico+IA."""

    from .ai_parser import AiSowParserError

    serializer = AiSowParserOutputSchema(data=data if isinstance(data, dict) else {})
    if not serializer.is_valid():
        raise AiSowParserError(
            f"JSON retornado pela IA não bate com o schema esperado: {serializer.errors}",
            code="OPENROUTER_SCHEMA_ERROR",
        )
    return list(serializer.validated_data["items"])
