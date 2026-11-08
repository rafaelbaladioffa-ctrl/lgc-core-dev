import type { Me } from "../api/types";

export function hasPerm(user: Me | null, permission: string): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return user.permissions.includes(permission);
}

export function hasAnyPerm(user: Me | null, permissions: string[]): boolean {
  if (!user) return false;
  if (user.is_superuser) return true;
  return permissions.some((p) => user.permissions.includes(p));
}

export interface ModelPerms {
  view: string;
  add: string;
  change: string;
  delete: string;
}

/** Monta os 4 codenames padrão do Django (view/add/change/delete) para um
 * model — espelha exatamente o que o Django cria automaticamente para
 * cada model e o que os Grupos concedem no Admin. */
export function modelPerms(app: string, model: string): ModelPerms {
  return {
    view: `${app}.view_${model}`,
    add: `${app}.add_${model}`,
    change: `${app}.change_${model}`,
    delete: `${app}.delete_${model}`,
  };
}

export const PERMS = {
  viewProject: "projects.view_project",
  addProject: "projects.add_project",
  changeProject: "projects.change_project",
  deleteProject: "projects.delete_project",
  addRackPosition: "projects.add_rackposition",
  changeRackPosition: "projects.change_rackposition",
  deleteRackPosition: "projects.delete_rackposition",
  addProjectTask: "projects.add_projecttask",
  changeProjectTask: "projects.change_projecttask",
  manageProjectTasks: "projects.manage_project_tasks",
  deleteProjectTask: "projects.delete_projecttask",
  viewProjectOccurrence: "projects.view_projectoccurrence",
  addProjectOccurrence: "projects.add_projectoccurrence",
  changeProjectOccurrence: "projects.change_projectoccurrence",
  deleteProjectOccurrence: "projects.delete_projectoccurrence",
  viewProjectAttachment: "projects.view_projectattachment",
  addProjectAttachment: "projects.add_projectattachment",
  deleteProjectAttachment: "projects.delete_projectattachment",
  accessRegistryScreen: "core.access_registry_screen",
  viewDailyUpdate: "updates.view_dailyupdate",
  addDailyUpdate: "updates.add_dailyupdate",
  changeDailyUpdate: "updates.change_dailyupdate",
  deleteDailyUpdate: "updates.delete_dailyupdate",
  viewProjectUpdate: "updates.view_projectdailyupdate",
  addProjectUpdate: "updates.add_projectdailyupdate",
  changeProjectUpdate: "updates.change_projectdailyupdate",
  viewMyTasks: "technical.view_mytask",
  changeMyTasks: "technical.change_mytask",
  viewPresence: "dispatch.view_techniciandailypresence",
  addPresence: "dispatch.add_techniciandailypresence",
  viewOperationsBoard: "projects.view_projecttaskassignment",
  dispatchTask: "projects.change_projecttask",
  viewCompany: "core.view_company",
  viewClient: "core.view_client",
  viewSite: "core.view_site",
  changeSite: "core.change_site",
  viewCategory: "core.view_category",
  viewProjectType: "core.view_projecttype",
  viewConsultimerProjectType: "core.view_consultimerprojecttype",
  viewJobTitle: "core.view_jobtitle",
  viewCollaborator: "core.view_collaborator",
  viewResponsible: "core.view_responsible",
  viewTask: "core.view_task",
  viewCableFamily: "master_data.view_cablefamily",
  viewCableAlias: "master_data.view_cablealias",
  viewCableSpec: "master_data.view_cablespec",
  viewCertificationType: "master_data.view_certificationtype",
  viewActivity: "master_data.view_activity",
  viewNetwork: "master_data.view_network",
  viewWorkstream: "master_data.view_workstream",
  viewPath: "master_data.view_path",
  viewMasterDataSite: "master_data.view_site",
  viewLocation: "master_data.view_location",
  viewDeviceType: "master_data.view_devicetype",
  viewTaskTemplate: "master_data.view_tasktemplate",
  viewTaskTemplateStep: "master_data.view_tasktemplatestep",
  viewTaskTemplateRule: "master_data.view_tasktemplaterule",
  viewScopeItem: "master_data.view_scopeitem",
  viewGeneratedTask: "master_data.view_generatedtask",
  viewSowImport: "master_data.view_sowimport",
  addSowImport: "master_data.add_sowimport",
  changeSowImport: "master_data.change_sowimport",
  changeSowParsedItem: "master_data.change_sowparseditem",
  viewBotMessageTemplate: "bot.view_botmessagetemplate",
  changeBotMessageTemplate: "bot.change_botmessagetemplate",
};

export const MASTER_DATA_PERMS = [
  PERMS.viewCableFamily,
  PERMS.viewCableAlias,
  PERMS.viewCableSpec,
  PERMS.viewCertificationType,
  PERMS.viewActivity,
  PERMS.viewNetwork,
  PERMS.viewWorkstream,
  PERMS.viewPath,
  PERMS.viewMasterDataSite,
  PERMS.viewLocation,
  PERMS.viewDeviceType,
  PERMS.viewTaskTemplate,
  PERMS.viewTaskTemplateStep,
  PERMS.viewTaskTemplateRule,
  PERMS.viewScopeItem,
  PERMS.viewGeneratedTask,
  PERMS.viewSowImport,
];

// A tela "Cadastros Gerais" tem permissão própria (core.access_registry_screen).
// As permissões view_* de cada cadastro continuam servindo só para ler os dados
// em outras telas (Projetos, Tarefas...), sem abrir a tela de cadastros.
export const CADASTROS_PERMS = [PERMS.accessRegistryScreen];
