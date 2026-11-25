begin;
insert into public.team_permission_catalog(permission,scopes) values('personnel.manage','{agency}');
notify pgrst,'reload schema';
commit;
